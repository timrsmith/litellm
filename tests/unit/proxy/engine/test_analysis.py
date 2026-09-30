from typing import Final

import pytest

from litellm.proxy.engine.analysis import Candidate, Examined, evidence_valid, investigate, partition_content
from litellm.proxy.engine.models import (
    Claim,
    Evidence,
    Execution,
    ExecutionContent,
    ModelRequest,
    ModelResult,
    TracePart,
)
from litellm.proxy.engine.state import queue_job
from tests.unit.proxy.engine.test_state import NOW, engine, finding


def test_quote_must_match_the_claimed_execution_and_span() -> None:
    part: Final = TracePart(execution_id="run1", span_id="span", name="search", kind="tool", content="timeout")
    assert evidence_valid(Evidence(execution_id="run1", span_id="span", quote="timeout"), (part,))
    assert not evidence_valid(Evidence(execution_id="other", span_id="span", quote="timeout"), (part,))
    assert not evidence_valid(Evidence(execution_id="run1", span_id="other", quote="timeout"), (part,))
    assert not evidence_valid(Evidence(execution_id="run1", span_id="span", quote="success"), (part,))


def test_chunks_preserve_all_spans_and_keep_context_bounded() -> None:
    parts: Final = tuple(
        TracePart(execution_id="run", span_id=str(i), name="tool", kind="tool", content="x" * 8000) for i in range(10)
    )
    chunks: Final = partition_content(parts)
    assert tuple(len(chunk) for chunk in chunks) == (3, 3, 3, 1)
    assert sum(len(chunk) for chunk in chunks) == 10
    assert tuple(p.span_id for p in chunks[-1]) == ("9",)


@pytest.mark.asyncio
async def test_investigator_rejects_a_fabricated_quote() -> None:
    execution: Final = Execution(
        id="run1", source="traces", trace_id="t", team_id="alpha", name="search", start_time="", span_count=1
    )
    examined: Final = Examined(
        execution=execution,
        observations=(),
        parts=(TracePart(execution_id="run1", span_id="span", name="search", kind="tool", content="succeeded"),),
        partial=False,
        cannot_assess=False,
    )

    async def model(_request: ModelRequest) -> ModelResult:
        return ModelResult(content='{"action":"submit","finding":' + finding("run1").model_dump_json() + "}", cost=0)

    async def read(_execution_id: str, _cursor: str, _offset: int) -> ExecutionContent:
        return ExecutionContent(execution=execution, parts=examined.parts)

    claim: Final = Claim(engine_id="engine", job=queue_job(engine(), NOW, "job").jobs[0], findings=())
    result: Final = await investigate(
        claim,
        Candidate(check_id="retries", title="Retries", hypothesis="Unrecovered", execution_ids=("run1",)),
        (examined,),
        read,
        model,
    )
    assert result.finding is None
