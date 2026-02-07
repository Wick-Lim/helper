// Agentic OS — Scenario Tests (bun:test)
// 검증 기준: LLM 텍스트가 아니라 관측 가능한 결과(tool output, 파일, DB, HTTP)

import { describe, test, expect, beforeAll } from "bun:test";
import { chat, dockerExec, fetchJson, putJson, sid, BASE, type ChatResult } from "./helpers";

// ─────────────────────────────────────────────────────────
describe("S1: 서버 장애 대응", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(sid("s1"), "서버 디스크 사용량 확인하고 /tmp 아래에서 제일 큰 파일 5개 찾아줘.");
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("shell tool 사용됨", () => expect(r.toolCalls).toContain("shell"));
  test("df/du 출력 포함", () => {
    const output = r.toolOutputs.join("\n");
    expect(output).toMatch(/Filesystem|[0-9]+%/);
  });
});

// ─────────────────────────────────────────────────────────
describe("S2: 로그 분석", () => {
  let r: ChatResult;
  beforeAll(async () => {
    await dockerExec("sh", "-c", `cat > /tmp/agent/app.log << 'LOGEOF'
2026-02-07 09:02:45 ERROR Database connection timeout after 30s
2026-02-07 09:03:05 ERROR Database connection failed: ECONNREFUSED
2026-02-07 09:06:30 ERROR OutOfMemoryError: heap space exceeded
2026-02-07 09:10:00 ERROR NullPointerException at PaymentService.java:142
LOGEOF`);
    r = await chat(sid("s2"), "/tmp/agent/app.log 파일을 읽고 에러만 분석해줘. 에러 종류별로 분류해줘.");
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("file tool로 로그 읽음", () => expect(r.toolCalls).toContain("file"));
  test("로그 내용이 tool output에 포함", () => {
    const output = r.toolOutputs.join("\n");
    expect(output).toMatch(/Database|OutOfMemory|NullPointer/);
  });
});

// ─────────────────────────────────────────────────────────
describe("S3: 웹사이트 스크린샷 분석", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(sid("s3"), "https://github.com 스크린샷 찍고 페이지 내용을 설명해줘.");
  }, 120_000);

  test("스트림 정상 완료 (토큰 초과 없음)", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("browser tool 사용됨", () => expect(r.toolCalls).toContain("browser"));
  test("이미지 URL 반환됨", () => expect(r.images.length).toBeGreaterThanOrEqual(1));

  test("이미지 URL HTTP 200 + image/jpeg", async () => {
    if (r.images.length === 0) return; // covered by above test
    const imgUrl = r.images[0].url;
    const res = await fetch(`${BASE}${imgUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
  });

  test("스크린샷 파일 디스크에 저장됨", async () => {
    const files = await dockerExec("ls", "/data/screenshots/");
    expect(files.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────
describe("S4: Python 스크립트 실행", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(
      sid("s4"),
      "code tool을 사용해서 Python으로 https://httpbin.org/status/200 과 https://httpbin.org/status/404 에 GET 요청을 보내고 각각의 상태코드를 출력해줘. 반드시 code tool로 실행해."
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("tool 사용됨 (code/shell/web)", () => {
    const used = r.toolCalls.some((t) => ["code", "shell", "web"].includes(t));
    expect(used).toBe(true);
  });
  test("tool output에 200 포함", () => {
    expect(r.toolOutputs.join("\n")).toContain("200");
  });
  test("tool output에 404 포함", () => {
    expect(r.toolOutputs.join("\n")).toContain("404");
  });
});

// ─────────────────────────────────────────────────────────
describe("S5: 파일 생성 + 검증", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(
      sid("s5"),
      '/tmp/agent/myapp/app.py 에 Flask hello world 앱을 만들어줘. / 경로에서 JSON {"status":"ok"} 를 반환하게 해줘.'
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("file tool 사용됨", () => expect(r.toolCalls).toContain("file"));

  test("app.py 파일 존재 + Flask 포함", async () => {
    const content = await dockerExec("cat", "/tmp/agent/myapp/app.py");
    expect(content).toBeTruthy();
    expect(content).toMatch(/flask|Flask/);
    expect(content).toMatch(/status|ok/);
  });
});

// ─────────────────────────────────────────────────────────
describe("S6: 데이터 분석", () => {
  let r: ChatResult;
  beforeAll(async () => {
    await dockerExec("sh", "-c", `mkdir -p /tmp/agent && cat > /tmp/agent/sales.csv << 'EOF'
month,revenue,costs
Jan,1000,600
Feb,1500,800
Mar,1200,700
Apr,2000,900
May,1800,1000
Jun,2200,1100
EOF`);
    r = await chat(
      sid("s6"),
      "/tmp/agent/sales.csv 를 읽어서 각 월의 profit(revenue-costs)을 계산하고, 가장 높은 profit 월과 금액을 출력해줘."
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("tool output에 profit 계산 결과 포함", () => {
    const output = r.toolOutputs.join("\n");
    expect(output).toMatch(/1100|Jun/);
  });
});

// ─────────────────────────────────────────────────────────
describe("S7: 멀티턴 — 회의 메모 저장 + 회상", () => {
  const session = sid("s7");

  test("메모리에 저장 → REST API로 검증", async () => {
    await chat(
      session,
      '메모리에 저장해줘. key는 "project-aurora", value는 "릴리스 2월28일, 블로커: PG사 연동 지연, 담당: 김팀장"'
    );
    const mem = await fetchJson<Array<Record<string, string>>>("/api/memory?q=aurora");
    expect(mem.length).toBeGreaterThan(0);
    expect(JSON.stringify(mem)).toMatch(/PG|블로커|지연/);
  }, 120_000);

  test("메모리 회상 — 블로커 정보 반환", async () => {
    const r = await chat(session, "project-aurora 메모리에서 블로커가 뭐였지?");
    expect(r.toolCalls).toContain("memory");
    expect(r.toolOutputs.join("\n")).toMatch(/PG|블로커|지연/);
  }, 120_000);

  test("대화 히스토리 4건 이상", async () => {
    const hist = await fetchJson<unknown[]>(`/api/sessions/${session}/history`);
    expect(hist.length).toBeGreaterThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────
describe("S8: 에러 복구", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(
      sid("s8"),
      '/tmp/agent/ghost.txt 파일을 읽어봐. 없으면 "hello from recovery"라는 내용으로 만들고 다시 읽어서 확인해줘.'
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("file tool 2회 이상 호출", () => {
    const fileCalls = r.toolCalls.filter((t) => t === "file").length;
    expect(fileCalls).toBeGreaterThanOrEqual(2);
  });
  test("파일 실제 생성 + 내용 일치", async () => {
    const content = await dockerExec("cat", "/tmp/agent/ghost.txt");
    expect(content).toBeTruthy();
    expect(content).toContain("hello from recovery");
  });
});

// ─────────────────────────────────────────────────────────
describe("S9: 보고서 자동 생성", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(
      sid("s9"),
      "시스템 상태 리포트를 마크다운으로 /tmp/agent/report.md 에 저장해줘. OS버전, 디스크, 메모리, 프로세스 수 포함."
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("3개 이상 tool 호출", () => {
    expect(r.toolCalls.length).toBeGreaterThanOrEqual(3);
  });
  test("report.md 파일 존재 + 마크다운 + 시스템 정보", async () => {
    const report = await dockerExec("cat", "/tmp/agent/report.md");
    expect(report).toBeTruthy();
    expect(report).toMatch(/^#/m); // markdown heading
    expect(report).toMatch(/linux|debian|disk|memory|process|메모리|디스크/i);
  });
});

// ─────────────────────────────────────────────────────────
describe("S10: 크로스 도구 파이프라인", () => {
  let r: ChatResult;
  beforeAll(async () => {
    r = await chat(
      sid("s10"),
      'web tool로 https://httpbin.org/uuid 에서 UUID를 가져오고, code tool로 Python을 써서 그 UUID를 대문자로 변환하고, 결과를 memory tool에 key="latest-uuid"로 저장해줘.'
    );
  }, 120_000);

  test("스트림 정상 완료", () => {
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);
  });
  test("web tool 사용", () => expect(r.toolCalls).toContain("web"));
  test("code tool 사용", () => expect(r.toolCalls).toContain("code"));
  test("memory tool 사용", () => expect(r.toolCalls).toContain("memory"));

  test("메모리에 UUID 저장됨", async () => {
    const mem = await fetchJson<Array<Record<string, string>>>("/api/memory?q=latest-uuid");
    expect(mem.length).toBeGreaterThan(0);
    expect(mem[0].key).toMatch(/uuid/i);
  });
});

// ─────────────────────────────────────────────────────────
describe("S11: 설정 변경 즉시 반영", () => {
  test("temperature=0.1 반영 → 응답 → 복원", async () => {
    await putJson("/api/config/temperature", { value: "0.1" });
    const cfg = await fetchJson<Record<string, string>>("/api/config");
    expect(cfg.temperature).toBe("0.1");

    const r = await chat(sid("s11"), "7 곱하기 8은?");
    expect(r.isDone).toBe(true);
    expect(r.hasError).toBe(false);

    // restore
    await putJson("/api/config/temperature", { value: "0.7" });
  }, 120_000);
});
