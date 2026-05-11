const { readFile } = require("node:fs/promises");
(async () => {
  const { chromium } = require("playwright");
  const connections = JSON.parse(await readFile("/home/jiaxu/.openclaw-educlaw/workspace/state/education/connections.json","utf8"));
  const baseCookie = connections[0].auth.cookie;
  const freshCookie = `_zte_cid_=c6c34de8-dc16-6ca4-5397-44c9eac04b00;_token=ab4dedf939fbef0290dc6f458362adb07a16b7fa572ba1018cb748f93e221285a%3A2%3A%7Bi%3A0%3Bs%3A6%3A%22_token%22%3Bi%3A1%3Bs%3A673%3A%22eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50IjoiMjUzNzMwNzgiLCJjbWNHcm91cENvZGUiOiIxNDk5MDAwMDA1IiwiY21jR3JvdXBJZCI6IjZmMjg3MzYyMDA3OGMwZTYwZDIzMTQ1ZTMyMzgyMTgxIiwiY3VycmVudFJvbGUiOiJzdHVkZW50IiwiZXhwIjoxNzc2MjU0ODk4LCJsb2dpblR5cGUiOiJkZWZhdWx0IiwibXJvbGVzIjpbeyJjbWNfcm9sZSI6Ijk2NWU4OGM0MjVhNDliNzI5MjZkZDMwZTZmNGI4M2MyIiwiY29kZSI6InN0dWRlbnQiLCJjcmVhdGVkX2F0IjoiMjAxOC0wMy0xNyAxMDo0NzowNiIsImRlc2NyaXB0aW9uIjoiIiwiY3VycmVudFJvbGUiOiJzdHVkZW50IiwiZGlzcGxheV9uYW1lIjoi5a2m55SfIiwiaWQiOjE1LCJpc2RlZmF1bHQiOjEsInN0YXR1cyI6MH1dLCJwYXNzd29yZCI6ImEzMDVmYjc5ZTFlY2QwYTZlNDI5MDJmYTNiMWIwZWYyIiwicmVhbG5hbWUiOiLlp5rkvbPml60iLCJzdWIiOjEwOTY0MDYsInRlbmFudF9pZCI6MjF9.mKZSb4tgRcWWP7OHykMvNm7faJ4QXqNXpgZM2ls528s%22%3B%7D`;
  const parse = (header) => new Map(header.split(";").map(s=>s.trim()).filter(Boolean).map(s=>{ const i=s.indexOf("="); return [s.slice(0,i), s.slice(i+1)]; }));
  const merged = parse(baseCookie);
  for (const [k,v] of parse(freshCookie)) merged.set(k,v);
  const cookies = [];
  for (const [name, value] of merged.entries()) {
    const domain = ["_zte_cid_"].includes(name) ? ".buaa.edu.cn" : ".msa.buaa.edu.cn";
    cookies.push({ name, value, domain, path: "/", secure: true, httpOnly: false, sameSite: "None" });
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();
  page.on("response", async (response) => {
    const url = response.url();
    if (!/courseapi|pptnote|userapi|trans|subtitle|note|summary/i.test(url)) return;
    try {
      const text = await response.text();
      console.log("URL", url);
      console.log("STATUS", response.status());
      console.log(text.slice(0, 500));
      console.log("---");
    } catch {}
  });
  await page.goto("https://classroom.msa.buaa.edu.cn/coursedetail?course_id=138894&sub_id=5714534", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(5000);
  await browser.close();
})();
