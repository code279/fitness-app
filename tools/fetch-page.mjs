#!/usr/bin/env node
/**
 * fetch-page.mjs — 링크 하나에서 "더 보기" 안쪽까지 전부 긁어냅니다. 브라우저 없이.
 *
 *   node tools/fetch-page.mjs <URL> [--out DIR] [--quiet]
 *
 * 왜 브라우저를 안 쓰나
 *   에어비앤비 같은 요즘 사이트는 화면에 그릴 데이터를 HTML 안에 JSON으로 심어서 보냅니다.
 *   "더 보기"를 눌러야 보이는 편의시설 목록 · 설명 전문 · 침구 구성 · 신고번호까지
 *   그 JSON에 이미 들어 있습니다. 즉 클릭이 필요한 게 아니라 꺼내면 됩니다.
 *   브라우저(Playwright)는 이 환경의 프록시를 통과하지 못하고, 통과시키려 TLS를 낮추는 건
 *   컨테이너 격리를 우회하는 행위라 하지 않습니다. curl은 정상 동작하므로 그 길을 씁니다.
 *
 * 만들어지는 파일 (--out 디렉터리)
 *   page.html      원본 HTML
 *   text.txt       태그를 벗긴 본문 텍스트
 *   data-NN.json   페이지에 심겨 있던 JSON 블록 (보기 좋게 정렬)
 *   flat.txt       위 JSON을 `경로 = 값` 한 줄씩 펼친 것  ← grep 하기 가장 편함
 *   findings.txt   신고번호 · 침실/욕실 수 · 준공연도 · 가격 등 값어치 있는 항목만 추린 것
 *   meta.json      URL · 제목 · 블록 수 · 차단 여부
 */
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const pexec = promisify(execFile);
const argv = process.argv.slice(2);
const url = argv.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.error("사용법: node tools/fetch-page.mjs <URL> [--out DIR]");
  process.exit(2);
}
const gi = argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(gi >= 0 && argv[gi + 1] ? argv[gi + 1] : path.join(".fetch", stamp));
const quiet = argv.includes("--quiet");
const log = (...a) => { if (!quiet) console.log("·", ...a); };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function main() {
  await mkdir(outDir, { recursive: true });

  log("받는 중:", url);
  let html = "", httpCode = "000";
  try {
    const { stdout } = await pexec("curl", [
      "-sSL", "--max-time", "60", "--compressed",
      "-A", UA,
      "-H", "Accept-Language: ko-KR,ko;q=0.9,en;q=0.8",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-w", "\n<<<HTTPCODE:%{http_code}>>>",
      url,
    ], { maxBuffer: 200 * 1024 * 1024 });
    const m = stdout.match(/\n<<<HTTPCODE:(\d+)>>>$/);
    httpCode = m ? m[1] : "000";
    html = m ? stdout.slice(0, m.index) : stdout;
  } catch (e) {
    console.error("받기 실패:", (e.stderr || e.message || "").trim().split("\n")[0]);
    console.error("\n이 도메인이 환경의 네트워크 허용 목록에 있는지 확인하세요.");
    process.exit(3);
  }
  log(`HTTP ${httpCode} · ${html.length.toLocaleString()}자`);
  await writeFile(path.join(outDir, "page.html"), html, "utf8");

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].trim();

  // ── 본문 텍스트
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  await writeFile(path.join(outDir, "text.txt"), text, "utf8");

  // ── 심겨 있는 JSON 블록 꺼내기
  const blobs = [];
  // (1) <script type="application/json"> ... </script>
  for (const m of html.matchAll(
    /<script\b[^>]*type=["'](?:application\/json|application\/ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    blobs.push({ how: "script-json", id: (m[0].match(/id=["']([^"']+)["']/) || [, ""])[1], raw: m[1] });
  }
  // (2) window.X = {...};  /  self.__next_f.push([...])
  for (const m of html.matchAll(
    /(?:window|self|globalThis)\.([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*;?\s*<\/script>/g
  )) {
    blobs.push({ how: "window-assign", id: m[1], raw: m[2] });
  }

  const parsed = [];
  let n = 0;
  for (const b of blobs) {
    let obj;
    try { obj = JSON.parse(unescapeJson(b.raw)); } catch { continue; }
    n += 1;
    const name = `data-${String(n).padStart(2, "0")}.json`;
    await writeFile(path.join(outDir, name), JSON.stringify(obj, null, 2), "utf8");
    parsed.push({ file: name, how: b.how, id: b.id, obj });
    log(`JSON 블록 ${name}  (${b.how}${b.id ? " · " + b.id : ""})`);
  }

  // ── 평탄화: `경로 = 값` 한 줄씩. grep 하기 위한 것.
  const lines = [];
  for (const p of parsed) flatten(p.obj, p.file.replace(/\.json$/, ""), lines);
  await writeFile(path.join(outDir, "flat.txt"), lines.join("\n"), "utf8");
  log(`평탄화 ${lines.length.toLocaleString()}줄 → flat.txt`);

  // ── 값어치 있는 항목만 추리기
  const HUNT = [
    ["신고·등록번호", /(M\d{2}-?\d{3,}|登録番号|届出番号|신고번호|registration\s*number|license\s*number|licen[cs]e[^a-z])/i],
    ["준공·연식", /(준공|신축|築年|建築年|built\s*in|year\s*built|renovat|리모델링|단장)/i],
    ["침실·침대·욕실", /(침실|침대|욕실|화장실|샤워|세면대|bedroom|bathroom|shower|toilet|sink|寝室|浴室|シャワー)/i],
    ["정원", /(최대\s*인원|정원|guests?\b|max.{0,8}guest|人数)/i],
    ["위치·역", /(역에서|도보|徒歩|walk\s*\d|\bstation\b|min(ute)?s?\s*to\b)/i],
    ["가격", /(총액|1박|per\s*night|total|₩|￥|\bJPY\b|\bKRW\b)/i],
    ["평점·후기", /(평점|후기|rating|review|★|guest\s*favou?rite|superhost|슈퍼호스트)/i],
    ["취소·환불", /(취소\s*수수료|환불|cancellation|refund)/i],
  ];
  const findings = [];
  const hay = lines.concat(text.split("\n"));
  for (const [label, re] of HUNT) {
    const hits = [...new Set(hay.filter((l) => re.test(l) && l.length < 400))].slice(0, 60);
    findings.push(`\n${"=".repeat(70)}\n${label}  (${hits.length}건)\n${"=".repeat(70)}`);
    findings.push(hits.length ? hits.join("\n") : "(없음)");
  }
  await writeFile(path.join(outDir, "findings.txt"), findings.join("\n"), "utf8");

  const blockedRe = /(사람인지 확인|보안 문자|captcha|are you a robot|confirm you(’|')?re human|Access Denied|unusual traffic)/i;
  const blocked = blockedRe.test(text.slice(0, 8000));

  const meta = { url, title, httpCode, fetchedAt: new Date().toISOString(),
                 htmlChars: html.length, textChars: text.length,
                 jsonBlocks: parsed.map((p) => ({ file: p.file, how: p.how, id: p.id })),
                 flatLines: lines.length, blocked, outDir };
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

  console.log("\n" + JSON.stringify({ ...meta, jsonBlocks: meta.jsonBlocks.length }, null, 2));
  if (blocked) { console.error("\n⚠ 봇 차단 화면으로 보입니다. text.txt를 확인하세요."); process.exit(4); }
  if (text.length < 400 && !parsed.length) {
    console.error("\n⚠ 내용이 거의 없습니다. 자바스크립트로만 그려지는 페이지일 수 있습니다.");
    process.exit(5);
  }
  console.log(`\n✓ 저장 위치: ${outDir}`);
  console.log("  먼저 볼 것: findings.txt → flat.txt(grep) → text.txt");
}

// JSON이 HTML 속성/문자열로 한 번 더 escape 돼 있는 경우를 풀어준다
function unescapeJson(s) {
  let t = s.trim().replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
  if (/\\u0022|\\"/.test(t) && !/^[[{]/.test(t)) {
    try { return JSON.parse(t); } catch {}
  }
  return t;
}

function flatten(v, prefix, out, depth = 0) {
  if (depth > 40 || out.length > 400000) return;
  if (v === null || v === undefined) return;
  if (typeof v === "object") {
    if (Array.isArray(v)) v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out, depth + 1));
    else for (const k of Object.keys(v)) flatten(v[k], `${prefix}.${k}`, out, depth + 1);
    return;
  }
  const s = String(v);
  if (!s.trim() || s === "false" || s === "true") return;
  if (s.length > 2000) return;
  out.push(`${prefix} = ${s.replace(/\s+/g, " ")}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
