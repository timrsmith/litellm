SELECT *, count() OVER () AS eligible FROM (
    SELECT 'traces' AS source, TraceId AS trace_id, TeamId AS team_id,
        argMin(SpanName, Timestamp) AS name, toString(min(Timestamp)) AS start_time,
        uniqExact(SpanId) AS span_count, countIf(ParentSpanId='') > 0 AS root_seen
    FROM otel_traces
    WHERE {source:String} IN ('traces','both')
      AND ({all_teams:UInt8}=1 OR TeamId={team:String})
      AND ({key_hash:String}='' OR ApiKeyHash={key_hash:String})
      AND (TeamId,TraceId) IN (
          SELECT TeamId,TraceId FROM otel_traces
          WHERE ({all_teams:UInt8}=1 OR TeamId={team:String})
            AND ({key_hash:String}='' OR ApiKeyHash={key_hash:String})
            AND if(EngineReceivedMs>0,toInt64(EngineReceivedMs),
                toUnixTimestamp64Milli(Timestamp)+toInt64(intDiv(Duration,1000000))) >= {start:UInt64}
      )
    GROUP BY TeamId,TraceId
    HAVING max(EngineReceivedMs) < {end:UInt64}
       AND max(toUnixTimestamp64Milli(Timestamp)+toInt64(intDiv(Duration,1000000))) < {end:UInt64}
       AND countIf(arrayAll((k,v) -> ResourceAttributes[k]=v OR SpanAttributes[k]=v,
           {filter_keys:Array(String)},{filter_values:Array(String)})
           AND ({service:String}='' OR ServiceName={service:String})) > 0
    UNION ALL
    SELECT 'requests' AS source, request_id AS trace_id, team_id, model AS name,
        toString(start_time) AS start_time, toUInt64(1) AS span_count, toUInt8(1) AS root_seen
    FROM spend_logs FINAL
    WHERE {source:String} IN ('requests','both')
      AND ({all_teams:UInt8}=1 OR team_id={team:String})
      AND ({key_hash:String}='' OR api_key={key_hash:String})
      AND if(EngineReceivedMs>0,toInt64(EngineReceivedMs),toUnixTimestamp64Milli(end_time)) >= {start:UInt64}
      AND EngineReceivedMs < {end:UInt64}
      AND toUnixTimestamp64Milli(end_time) < {end:UInt64}
      AND arrayAll((k,v) -> JSONExtractString(metadata,k)=v
          OR JSONExtractString(metadata,'requester_metadata',k)=v OR (k='tag' AND has(request_tags,v)),
          {filter_keys:Array(String)},{filter_values:Array(String)})
      AND ({service:String}='' OR model_group={service:String})
      AND NOT has(request_tags,'litellm-engine')
      AND ({source:String}!='both' OR (team_id,response_id) NOT IN (
          SELECT TeamId,LiteLLMRequestId FROM otel_traces
          WHERE ({all_teams:UInt8}=1 OR TeamId={team:String})
            AND ({key_hash:String}='' OR ApiKeyHash={key_hash:String}) AND LiteLLMRequestId!=''
      ))
)
ORDER BY cityHash64(concat(source,team_id,trace_id)) LIMIT {limit:UInt32}
