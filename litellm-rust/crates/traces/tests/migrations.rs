use std::collections::BTreeMap;

use litellm_http::Client;
use litellm_traces::{
    Connection, Error, InsertTable, Parameter, ReadQuery, ensure_schema, execute_named_read,
    execute_read, insert_rows, schema_statements,
};
use rstest::rstest;
use testcontainers_modules::{
    clickhouse::ClickHouse,
    testcontainers::{ImageExt, runners::AsyncRunner},
};

const CLICKHOUSE_TAG: &str =
    "26.9.6.6@sha256:eb4870e7ca7ed70c259eebfcfbee6cf797017f6b5436c2926bbbfe3d4d28486e";

#[rstest]
#[tokio::test]
async fn schema_supports_span_rollups_and_spend_joins() -> Result<(), Box<dyn std::error::Error>> {
    let container = ClickHouse::default()
        .with_tag(CLICKHOUSE_TAG)
        .with_env_var("CLICKHOUSE_SKIP_USER_SETUP", "1")
        .start()
        .await?;
    let url = format!(
        "http://{}:{}",
        container.get_host().await?,
        container.get_host_port_ipv4(8123).await?
    );
    let client = Client::no_redirect_for_test();
    let writer = Connection::writer(&url)?;
    ensure_schema(&client, &writer, "trace_test", 7, 14).await?;
    ensure_schema(&client, &writer, "trace_test", 7, 14).await?;
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp_nanos() as i64;
    let span = serde_json::from_value(serde_json::json!({
        "Timestamp": timestamp, "TraceId": "trace-1", "SpanId": "span-1", "ParentSpanId": "",
        "ServiceName": "proxy", "SpanName": "request", "Input": "hello world",
        "ResourceAttributes": {"litellm.team_id": "team-1", "litellm.api_key_hash": "hash-1", "run.name": "Research report", "swarm": "research"},
        "SpanAttributes": {"gen_ai.response.id": "response-1", "gen_ai.usage.input_tokens": "12"}
    }))?;
    let spend = serde_json::from_value(serde_json::json!({
        "request_id": "request-1", "response_id": "response-1", "team_id": "team-1", "api_key": "hash-1", "spend": 0.125,
        "start_time": timestamp / 1_000_000, "end_time": timestamp / 1_000_000 + 100,
        "completion_start_time": null,
        "metadata": serde_json::json!({"requester_metadata": {"swarm": "research"}}).to_string()
    }))?;
    insert_rows(
        &client,
        &writer,
        "trace_test",
        InsertTable::OtelTraces,
        vec![span],
    )
    .await?;
    insert_rows(
        &client,
        &writer,
        "trace_test",
        InsertTable::SpendLogs,
        vec![spend],
    )
    .await?;
    let invalid = serde_json::from_value(serde_json::json!({
        "Timestamp": timestamp,
        "TraceId": "trace-1",
        "SpanId": "span-invalid",
        "UnexpectedColumn": "must fail"
    }))?;
    let rejected = insert_rows(
        &client,
        &writer,
        "trace_test",
        InsertTable::OtelTraces,
        vec![invalid],
    )
    .await;
    assert!(
        matches!(rejected, Err(Error::InsertFailed(_))),
        "{rejected:?}"
    );
    let connection = Connection::configured(&url, "trace_test", "default", "")?;
    let detail = execute_named_read(
        &client,
        &connection,
        ReadQuery::SpanDetail,
        &BTreeMap::from([
            ("trace_id".to_owned(), Parameter::Text("trace-1".to_owned())),
            ("span_id".to_owned(), Parameter::Text("span-1".to_owned())),
            (
                "team_ids".to_owned(),
                Parameter::Strings(vec!["team-1".to_owned()]),
            ),
            (
                "api_key_hash".to_owned(),
                Parameter::Text("hash-1".to_owned()),
            ),
        ]),
    )
    .await?;
    let detail: serde_json::Value = serde_json::from_str(&detail)?;
    assert_eq!(detail["data"][0]["span_id"], "span-1");
    let body = execute_read(&client, &connection,
        "SELECT o.TeamId, o.ApiKeyHash, o.ObservationType, o.InputPreview, s.spend, \
         toString(toUnixTimestamp64Nano(o.Timestamp)) AS timestamp_ns, \
         toString(toUnixTimestamp64Milli(s.start_time)) AS start_ms \
         FROM otel_traces o JOIN spend_logs s ON o.LiteLLMRequestId = s.response_id AND o.TeamId = s.team_id",
        &BTreeMap::new()).await?;
    let response: serde_json::Value = serde_json::from_str(&body)?;
    assert_eq!(
        response["data"],
        serde_json::json!([{
            "TeamId": "team-1", "ApiKeyHash": "hash-1", "ObservationType": "agent",
            "InputPreview": "hello world", "spend": 0.125,
        "timestamp_ns": timestamp.to_string(), "start_ms": (timestamp / 1_000_000).to_string()
        }])
    );
    let body = execute_read(
        &client,
        &connection,
        "SELECT toUInt32(sum(SpanCount)) AS spans, toUInt32(sum(InputTokens)) AS tokens \
         FROM agent_traces WHERE TeamId = 'team-1' AND TraceId = 'trace-1'",
        &BTreeMap::new(),
    )
    .await?;
    let response: serde_json::Value = serde_json::from_str(&body)?;
    assert_eq!(
        response["data"],
        serde_json::json!([{"spans": 1, "tokens": 12}])
    );
    let lens_params = BTreeMap::from([
        ("source".to_owned(), Parameter::Text("both".to_owned())),
        ("all_teams".to_owned(), Parameter::Integer(0)),
        ("team".to_owned(), Parameter::Text("team-1".to_owned())),
        ("key_hash".to_owned(), Parameter::Text("hash-1".to_owned())),
        (
            "start".to_owned(),
            Parameter::Integer(timestamp / 1_000_000 - 1000),
        ),
        (
            "end".to_owned(),
            Parameter::Integer(timestamp / 1_000_000 + 1000),
        ),
        ("service".to_owned(), Parameter::Text(String::new())),
        ("filter_keys".to_owned(), Parameter::Strings(vec![])),
        ("filter_values".to_owned(), Parameter::Strings(vec![])),
        ("limit".to_owned(), Parameter::Integer(10)),
    ]);
    let sample =
        execute_named_read(&client, &connection, ReadQuery::LensSample, &lens_params).await?;
    let sample: serde_json::Value = serde_json::from_str(&sample)?;
    assert_eq!(sample["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(sample["data"][0]["trace_id"], "trace-1");
    assert_eq!(sample["data"][0]["name"], "Research report");
    assert_eq!(sample["data"][0]["service"], "proxy");
    assert!(
        sample["data"][0]["attributes"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!(["swarm", "research"]))
    );
    let request_params: BTreeMap<String, Parameter> = lens_params
        .into_iter()
        .chain([
            ("source".to_owned(), Parameter::Text("requests".to_owned())),
            (
                "filter_keys".to_owned(),
                Parameter::Strings(vec!["swarm".to_owned()]),
            ),
            (
                "filter_values".to_owned(),
                Parameter::Strings(vec!["research".to_owned()]),
            ),
        ])
        .collect();
    let requests =
        execute_named_read(&client, &connection, ReadQuery::LensSample, &request_params).await?;
    let requests: serde_json::Value = serde_json::from_str(&requests)?;
    assert_eq!(requests["data"].as_array().map(Vec::len), Some(1));
    assert!(
        requests["data"][0]["attributes"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!(["swarm", "research"]))
    );
    assert_eq!(requests["data"][0]["trace_id"], "request-1");
    let read_params: BTreeMap<String, Parameter> = request_params
        .into_iter()
        .chain([
            ("source".to_owned(), Parameter::Text("traces".to_owned())),
            ("id".to_owned(), Parameter::Text("trace-1".to_owned())),
            (
                "record_team".to_owned(),
                Parameter::Text("team-1".to_owned()),
            ),
            ("cursor".to_owned(), Parameter::Text(String::new())),
            ("offset".to_owned(), Parameter::Integer(1)),
            ("span".to_owned(), Parameter::Text("span-1".to_owned())),
            (
                "quote".to_owned(),
                Parameter::Text("hello world".to_owned()),
            ),
        ])
        .collect();
    let content =
        execute_named_read(&client, &connection, ReadQuery::LensContent, &read_params).await?;
    let content: serde_json::Value = serde_json::from_str(&content)?;
    assert_eq!(content["data"][0]["span_id"], "span-1");
    assert!(
        content["data"][0]["content"]
            .as_str()
            .is_some_and(|text| text.contains("hello world"))
    );
    let evidence =
        execute_named_read(&client, &connection, ReadQuery::LensEvidence, &read_params).await?;
    let evidence: serde_json::Value = serde_json::from_str(&evidence)?;
    assert_eq!(evidence["data"][0]["count"].as_u64(), Some(1));
    let other_team: BTreeMap<String, Parameter> = read_params
        .into_iter()
        .chain([("team".to_owned(), Parameter::Text("team-2".to_owned()))])
        .collect();
    let denied =
        execute_named_read(&client, &connection, ReadQuery::LensContent, &other_team).await?;
    let denied: serde_json::Value = serde_json::from_str(&denied)?;
    assert_eq!(denied["data"], serde_json::json!([]));
    Ok(())
}

#[rstest]
#[case::empty("", 7, 14)]
#[case::sql("db; DROP DATABASE default", 7, 14)]
#[case::trace_retention("traces", 0, 14)]
#[case::spend_retention("traces", 7, 0)]
fn schema_rejects_invalid_configuration(
    #[case] database: &str,
    #[case] traces: u32,
    #[case] spend: u32,
) {
    assert!(schema_statements(database, traces, spend).is_err());
}
