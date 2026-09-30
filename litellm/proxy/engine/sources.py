import base64
import json
from collections.abc import Awaitable, Mapping
from types import MappingProxyType
from typing import Final, Literal, Protocol

from pydantic import BaseModel, TypeAdapter

from litellm.proxy.engine.models import (
    EngineSettings,
    Evidence,
    Execution,
    ExecutionContent,
    MetadataFilter,
    Sample,
    Scope,
    TracePart,
)


class Storage(Protocol):
    def query(self, sql: str, parameters: Mapping[str, object] | None = None) -> Awaitable[object]: ...


class ExecutionRow(BaseModel):
    source: Literal["traces", "requests"]
    trace_id: str
    team_id: str
    name: str
    start_time: str
    span_count: int
    root_seen: int


class PartRow(BaseModel):
    span_id: str
    parent_span_id: str
    name: str
    kind: str
    content: str
    truncated: int


class CountRow(BaseModel):
    count: int


_ROWS: Final = TypeAdapter(tuple[ExecutionRow, ...])
_PARTS: Final = TypeAdapter(tuple[PartRow, ...])
_COUNTS: Final = TypeAdapter(tuple[CountRow, ...])


def execution_id(source: str, team_id: str, trace_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps((source, team_id, trace_id)).encode()).decode()


def parse_execution(value: str) -> tuple[str, str, str]:
    return TypeAdapter(tuple[str, str, str]).validate_json(base64.urlsafe_b64decode(value))


def parameters(scope: Scope, filters: tuple[MetadataFilter, ...]) -> Mapping[str, object]:
    return MappingProxyType(
        {
            "all_teams": int(scope.all_teams),
            "team": scope.team_id,
            "key_hash": scope.api_key_hash,
            **MappingProxyType({f"key{i}": f.key for i, f in enumerate(filters)}),
            **MappingProxyType({f"value{i}": f.value for i, f in enumerate(filters)}),
        }
    )


def selection(settings: EngineSettings, source: str) -> str:
    conditions: Final = tuple(
        (
            f"(ResourceAttributes[{{key{i}:String}}] = {{value{i}:String}} OR "
            f"SpanAttributes[{{key{i}:String}}] = {{value{i}:String}})"
        )
        if source == "traces"
        else (
            f"(JSONExtractString(metadata, {{key{i}:String}}) = {{value{i}:String}} OR "
            f"({{key{i}:String}} = 'tag' AND has(request_tags, {{value{i}:String}})))"
        )
        for i, _ in enumerate(settings.filters)
    )
    return " AND ".join(conditions) or "1"


def scope_sql(source: str) -> str:
    team, key = ("TeamId", "ApiKeyHash") if source == "traces" else ("team_id", "api_key")
    return (
        f"({{all_teams:UInt8}}=1 OR {team}={{team:String}}) AND ({{key_hash:String}}='' OR {key}={{key_hash:String}})"
    )


def query_for(settings: EngineSettings, source: str) -> str:
    if source == "traces":
        return f"""SELECT 'traces' AS source, TraceId AS trace_id, TeamId AS team_id,
          argMin(SpanName, Timestamp) AS name, toString(min(Timestamp)) AS start_time,
          uniqExact(SpanId) AS span_count, countIf(ParentSpanId='') > 0 AS root_seen
          FROM otel_traces WHERE {scope_sql(source)} GROUP BY TeamId, TraceId
          HAVING max(if(EngineReceivedMs>0, toInt64(EngineReceivedMs),
              toUnixTimestamp64Milli(Timestamp)+toInt64(intDiv(Duration,1000000)))) >= {{start:UInt64}}
          AND max(EngineReceivedMs) < {{end:UInt64}}
          AND max(toUnixTimestamp64Milli(Timestamp)+toInt64(intDiv(Duration,1000000))) < {{end:UInt64}}
          AND countIf(({selection(settings, source)}) AND ({{service:String}}='' OR ServiceName={{service:String}})) > 0"""
    linked: Final = (
        ""
        if settings.source != "both"
        else f"""AND (team_id,response_id) NOT IN
        (SELECT TeamId,LiteLLMRequestId FROM otel_traces WHERE {scope_sql("traces")} AND LiteLLMRequestId!='')"""
    )
    return f"""SELECT 'requests' AS source, request_id AS trace_id, team_id, model AS name,
      toString(start_time) AS start_time, toUInt64(1) AS span_count, toUInt8(1) AS root_seen
      FROM spend_logs FINAL WHERE {scope_sql(source)}
      AND if(EngineReceivedMs>0,toInt64(EngineReceivedMs),toUnixTimestamp64Milli(end_time)) >= {{start:UInt64}}
      AND EngineReceivedMs < {{end:UInt64}}
      AND toUnixTimestamp64Milli(end_time) < {{end:UInt64}}
      AND ({selection(settings, source)}) AND ({{service:String}}='' OR model_group={{service:String}})
      AND NOT has(request_tags,'litellm-engine') {linked}"""


class SourceReader:
    def __init__(self, storage: Storage) -> None:
        self.storage: Final = storage

    async def sample(self, scope: Scope, settings: EngineSettings, start: int, end: int) -> Sample:
        sources: Final = ("traces", "requests") if settings.source == "both" else (settings.source,)
        sql: Final = " UNION ALL ".join(query_for(settings, source) for source in sources)
        params: Final = MappingProxyType(
            {
                **parameters(scope, settings.filters),
                "start": start,
                "end": end,
                "service": settings.service,
                "limit": settings.sample_size,
            }
        )
        count_rows: Final = _COUNTS.validate_python(
            await self.storage.query(
                f"SELECT count() AS count FROM ({sql})",
                params,
            )
        )
        rows: Final = _ROWS.validate_python(
            await self.storage.query(
                f"SELECT * FROM ({sql}) ORDER BY cityHash64(concat(team_id,trace_id)) LIMIT {{limit:UInt32}}",
                params,
            )
        )
        return Sample(
            eligible=count_rows[0].count,
            executions=tuple(
                Execution(
                    id=execution_id(row.source, row.team_id, row.trace_id),
                    source=row.source,
                    trace_id=row.trace_id,
                    team_id=row.team_id,
                    name=row.name,
                    start_time=row.start_time,
                    span_count=row.span_count,
                    root_seen=bool(row.root_seen),
                )
                for row in rows
            ),
        )

    async def content(self, scope: Scope, execution: Execution, cursor: str = "", offset: int = 0) -> ExecutionContent:
        params: Final = MappingProxyType(
            {
                **parameters(scope, ()),
                "id": execution.trace_id,
                "record_team": execution.team_id,
                "cursor": cursor,
                "offset": offset + 1,
            }
        )
        sql: Final = (
            f"""SELECT SpanId AS span_id, ParentSpanId AS parent_span_id, SpanName AS name,
          ObservationType AS kind,
          substringUTF8(concat('Input: ',Input,'\nOutput: ',Output,'\nStatus: ',StatusCode,' ',StatusMessage),
              {{offset:UInt32}},8000) AS content,
          lengthUTF8(concat('Input: ',Input,'\nOutput: ',Output,'\nStatus: ',StatusCode,' ',StatusMessage))
              >= {{offset:UInt32}}+8000 AS truncated
          FROM otel_traces WHERE {scope_sql("traces")} AND TraceId={{id:String}}
          AND TeamId={{record_team:String}} AND SpanId > {{cursor:String}}
          ORDER BY SpanId LIMIT 1 BY SpanId LIMIT 40"""
            if execution.source == "traces"
            else f"""
          SELECT request_id AS span_id, '' AS parent_span_id, model AS name,'llm' AS kind,
          substringUTF8(concat('Input: ',messages,'\nOutput: ',response,'\nError: ',error_str),
              {{offset:UInt32}},8000) AS content,
          lengthUTF8(concat('Input: ',messages,'\nOutput: ',response,'\nError: ',error_str))
              >= {{offset:UInt32}}+8000 AS truncated
          FROM spend_logs FINAL WHERE {scope_sql("requests")} AND request_id={{id:String}}
          AND team_id={{record_team:String}} LIMIT 1"""
        )
        rows: Final = _PARTS.validate_python(await self.storage.query(sql, params))
        return ExecutionContent(
            execution=execution,
            parts=tuple(
                TracePart(
                    execution_id=execution.id,
                    span_id=row.span_id,
                    parent_span_id=row.parent_span_id,
                    name=row.name,
                    kind=row.kind,
                    content=row.content,
                    truncated=bool(row.truncated),
                )
                for row in rows
            ),
            next_cursor=rows[-1].span_id if len(rows) == 40 else None,
            partial=not execution.root_seen or any(row.truncated for row in rows),
        )

    async def verify_evidence(self, scope: Scope, execution: Execution, evidence: Evidence) -> bool:
        params: Final = MappingProxyType(
            {
                **parameters(scope, ()),
                "id": execution.trace_id,
                "record_team": execution.team_id,
                "span": evidence.span_id,
                "quote": evidence.quote,
            }
        )
        sql: Final = (
            f"""SELECT count() AS count FROM otel_traces WHERE {scope_sql("traces")}
            AND TraceId={{id:String}} AND TeamId={{record_team:String}} AND SpanId={{span:String}}
            AND position(concat('Input: ',Input,'\nOutput: ',Output,'\nStatus: ',StatusCode,' ',StatusMessage),{{quote:String}})>0"""
            if execution.source == "traces"
            else f"""SELECT count() AS count FROM spend_logs FINAL
            WHERE {scope_sql("requests")} AND request_id={{id:String}} AND team_id={{record_team:String}}
            AND request_id={{span:String}}
            AND position(concat('Input: ',messages,'\nOutput: ',response,'\nError: ',error_str),{{quote:String}})>0"""
        )
        rows: Final = _COUNTS.validate_python(await self.storage.query(sql, params))
        return bool(rows and rows[0].count)
