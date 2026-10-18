/** Styles for the Word Hunt HUD and the fallback word card. Lives inside a shadow root. */
export const OVERLAY_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.pm{--bg:#fffdf8;--card:#fff;--ink:#1f2340;--muted:#5b6080;--line:#e7e3f0;--pri:#3b5bdb;--pri-ink:#fff;--acc:#ef4f5f;--sun:#ffb703;--mint:#2fb380;
  --m:#0f8b8d;--f:#c2570c;font:15px/1.4 ui-rounded,"Nunito","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;color:var(--ink)}
@media (prefers-color-scheme: dark){.pm{--bg:#14162b;--card:#1d2040;--ink:#f2f3fb;--muted:#a7abc9;--line:#2e3260;--pri:#7c9bff;--pri-ink:#0d1030;--acc:#ff7a86;--m:#3cc6c8;--f:#ff9a5c}}
.hud{position:fixed;right:18px;bottom:18px;width:330px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:var(--bg);
  border:1px solid var(--line);border-radius:20px;box-shadow:0 18px 50px rgba(20,22,43,.28);z-index:2147483647;padding:14px 14px 12px}
.top{display:flex;align-items:center;gap:8px}
.title{font-weight:800;font-size:16px;flex:1}
.x{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--muted);font-size:18px}
.x:hover,.x:focus-visible{background:var(--line);color:var(--ink)}
.who{display:flex;align-items:center;gap:8px;margin:10px 0 6px;font-weight:700}
.av{font-size:22px;width:36px;height:36px;border-radius:50%;background:var(--card);border:1px solid var(--line);display:grid;place-items:center}
.score{margin-left:auto;font-variant-numeric:tabular-nums;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-weight:800}
.timer{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700}
.timer.low{color:var(--acc)}
.help{color:var(--muted);font-size:13px;margin:2px 0 10px}
ul.clues{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:6px}
ul.clues li{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:7px 10px}
ul.clues .em{font-size:20px;width:26px;text-align:center}
ul.clues .en{font-weight:700}
ul.clues .fr{margin-left:auto;font-weight:800;color:var(--mint)}
ul.clues li.done{border-color:color-mix(in srgb,var(--mint) 55%,var(--line));background:color-mix(in srgb,var(--mint) 10%,var(--card))}
ul.clues li.missed .fr{color:#e08a00}
.row{display:flex;gap:8px;flex-wrap:wrap}
button.b{all:unset;cursor:pointer;font-weight:800;border-radius:12px;padding:9px 14px;background:var(--card);border:1px solid var(--line);color:var(--ink);text-align:center}
button.b:hover{border-color:var(--pri)}
button.b:focus-visible{outline:3px solid color-mix(in srgb,var(--pri) 60%,transparent);outline-offset:2px}
button.b.pri{background:var(--pri);color:var(--pri-ink);border-color:transparent;flex:1}
button.b.good{background:var(--mint);color:#06281b;border-color:transparent;flex:1}
button.b.again{flex:1}
.msg{min-height:20px;font-size:13px;font-weight:700;margin:6px 0 8px;color:var(--muted)}
.msg.ok{color:var(--mint)} .msg.oops{color:var(--acc)}
.big{font-size:40px;text-align:center;margin:8px 0 2px}
.center{text-align:center}
.pod{list-style:none;padding:0;margin:10px 0;display:grid;gap:6px}
.pod li{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-weight:700}
.pod .pts{margin-left:auto;font-variant-numeric:tabular-nums}
.card{position:fixed;z-index:2147483647;width:280px;background:var(--bg);border:1px solid var(--line);border-radius:18px;box-shadow:0 16px 44px rgba(20,22,43,.28);padding:14px}
.word{font-size:26px;font-weight:800;display:flex;align-items:center;gap:8px}
.word .art{color:var(--muted);font-weight:700}
.g-m{color:var(--m)} .g-f{color:var(--f)}
.speak{all:unset;cursor:pointer;border-radius:50%;width:34px;height:34px;display:grid;place-items:center;background:var(--card);border:1px solid var(--line);font-size:16px}
.speak:focus-visible{outline:3px solid var(--pri)}
.mean{margin:4px 0 12px;font-size:15px}
.xp{color:var(--mint);font-weight:800}
@media (prefers-reduced-motion: no-preference){.pop{animation:pm-pop .25s ease}@keyframes pm-pop{from{transform:scale(.96);opacity:.4}to{transform:none;opacity:1}}}
`;
