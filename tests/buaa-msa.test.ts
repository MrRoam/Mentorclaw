import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { discoverBuaaMsaCourseMappings, syncBuaaMsa } from "../src/education/providers/buaa/msa.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture, withTestServer } from "./helpers.ts";

const parseFormBody = async (request: import("node:http").IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

describe("syncBuaaMsa", () => {
  test("discovers MSA course ids from the course catalog and persists them onto matching BYXT courses", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    await repo.writeCourses([
      {
        id: "course-byxt-physics",
        stableKey: "2026-spring:buaa-byxt:physics-1",
        title: "Physics A(1)",
        teacher: "[theory] Prof. Qi",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "BYXT-PHYS-1",
        status: "active",
        displayColor: null,
        metadata: {
          stableKeyHints: ["physics a(1)|[theory] prof. qi"],
          sourceAliases: {
            "buaa-byxt": "BYXT-PHYS-1",
          },
        },
      },
      {
        id: "course-byxt-ai",
        stableKey: "2026-spring:buaa-byxt:ai-1",
        title: "Artificial Intelligence",
        teacher: "[theory] Prof. Zhang",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "BYXT-AI-1",
        status: "active",
        displayColor: null,
        metadata: {
          stableKeyHints: ["artificial intelligence|[theory] prof. zhang"],
          sourceAliases: {
            "buaa-byxt": "BYXT-AI-1",
          },
        },
      },
    ]);

    await withTestServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const auth = request.headers.authorization;

      if (!auth || auth !== "Bearer mock-token") {
        response.writeHead(401);
        response.end("missing auth");
        return;
      }

      if (request.method === "GET" && url.pathname === "/yjapi/courseapi/v2/course-live/search-live-course-list") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            list: [
              { course_id: "course-physics" },
              { course_id: "course-ai" },
              { course_id: "course-physics" },
            ],
          }),
        );
        return;
      }

      if (request.method === "GET" && (url.pathname === "/yjapi/courseapi/v2/course-live/get-my-course-month" || url.pathname === "/yjapi/courseapi/v2/course-live/get-my-course-day")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 0, msg: "success", list: [] }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/yjapi/courseapi/v3/multi-search/get-course-detail") {
        const courseId = url.searchParams.get("course_id");
        response.writeHead(200, { "content-type": "application/json" });
        if (courseId === "course-physics") {
          response.end(
            JSON.stringify({
              code: 0,
              msg: "success",
              data: {
                course_title: "Physics A(1)",
                lecturer_name: "Prof. Qi",
                sub_list: [],
              },
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              course_title: "Artificial Intelligence",
              lecturer_name: "Prof. Zhang",
              sub_list: [],
            },
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await discoverBuaaMsaCourseMappings(repo, {
        auth: { token: "mock-token", account: "25373078" },
        term: "2026 Spring",
        baseUrls: {
          yjapiBase: `${baseUrl}/yjapi`,
          classroomBase: `${baseUrl}/classroom`,
        },
      });

      assert.deepEqual(result.discoveredCourseIds.sort(), ["course-ai", "course-physics"]);
      assert.equal(result.matchedCourseIds.length, 2);

      const snapshot = await repo.readSnapshot();
      assert.equal(snapshot.courses.length, 2);

      const physics = snapshot.courses.find((course) => course.id === "course-byxt-physics");
      const ai = snapshot.courses.find((course) => course.id === "course-byxt-ai");
      assert.equal(physics?.title, "Physics A(1)");
      assert.equal(physics?.teacher, "[theory] Prof. Qi");
      assert.equal(ai?.title, "Artificial Intelligence");
      assert.equal(ai?.teacher, "[theory] Prof. Zhang");
      assert.equal(physics?.metadata?.sourceAliases?.["buaa-msa"], "course-physics");
      assert.equal(physics?.metadata?.msaCourseId, "course-physics");
      assert.equal(ai?.metadata?.sourceAliases?.["buaa-msa"], "course-ai");
      assert.equal(ai?.metadata?.msaCourseId, "course-ai");

      assert.equal(snapshot.connections.some((connection) => connection.sourceType === "buaa-msa"), true);
      const msaConnection = snapshot.connections.find((connection) => connection.sourceType === "buaa-msa");
      assert.deepEqual((msaConnection?.metadata?.courseIds ?? []).slice().sort(), ["course-ai", "course-physics"]);
    });
  });

  test("imports replay items and replay-linked video and slide assets", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    await repo.writeCourses([
      {
        id: "course-byxt-os",
        stableKey: "2026-spring:buaa-byxt:os-1",
        title: "Operating Systems",
        teacher: "Prof. Li",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "BYXT-OS-1",
        status: "active",
        displayColor: null,
        metadata: {
          stableKeyHints: ["operating systems|prof. li"],
          sourceAliases: {
            "buaa-byxt": "BYXT-OS-1",
          },
        },
      },
    ]);

    await withTestServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const auth = request.headers.authorization;

      if (!auth || auth !== "Bearer test-token") {
        response.writeHead(401);
        response.end("missing auth");
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/userapi/v1/infosimple") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 200, message: "ok", params: { id: "user-1", tenant_id: "tenant-1", phone: "13800138000" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/yjapi/courseapi/v3/multi-search/get-course-detail") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              course_title: "Operating Systems",
              lecturer_name: "Prof. Li",
              sub_list: {
                chapter: [
                  {
                    id: "sub-1",
                    sub_title: "Lecture 01",
                    lecturer_name: "Prof. Li",
                    sub_status: "6",
                    start_time: "2026-04-01 08:00:00",
                    end_time: "2026-04-01 09:35:00",
                  },
                ],
              },
            },
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/courseapi/v3/portal-home-setting/get-sub-info") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              course_title: "Operating Systems",
              sub_title: "Lecture 01",
              lecturer_name: "Prof. Li",
              resource_guid: "rg-1",
              video_list: {
                video: {
                  preview_url: "/media/lecture-01.mp4",
                },
              },
            },
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/pptnote/v1/schedule/search-ppt") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            list: [
              { content: JSON.stringify({ pptimgurl: "https://cdn.example/0.jpg" }) },
              { content: JSON.stringify({ pptimgurl: "https://cdn.example/82370.jpg" }) },
            ],
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/pptnote/v1/schedule/search-trans-result") {
        assert.equal(url.searchParams.get("course_id"), "course-1");
        assert.equal(url.searchParams.get("sub_id"), "sub-1");
        assert.equal(url.searchParams.get("resource_guid"), "rg-1");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            list: [
              {
                all_content: [
                  { BeginSec: 0, EndSec: 2, Text: "Welcome to OS." },
                  { BeginSec: 2.5, EndSec: 5, Text: "Today we discuss processes." },
                ],
              },
            ],
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await syncBuaaMsa(repo, {
        auth: { token: "test-token", account: "24182104" },
        courseIds: ["course-1"],
        term: "2026 Spring",
        baseUrls: {
          yjapiBase: `${baseUrl}/yjapi`,
          classroomBase: `${baseUrl}/classroom`,
        },
      });

      assert.equal(result.importedCourses, 1);
      assert.equal(result.importedItems, 1);
      assert.equal(result.replayCount, 1);
      assert.equal(result.importedResources, 4);

      const snapshot = await repo.readSnapshot();
      assert.equal(snapshot.courses.length, 1);
      assert.equal(snapshot.courseItems.length, 1);
      assert.equal(snapshot.courseItems[0].type, "replay");
      assert.equal(snapshot.courseResources.length, 4);

      const ppt = snapshot.courseResources.find((resource) => resource.resourceType === "ppt");
      assert.ok(ppt?.localPath);
      const pptFile = await readFile(path.join(runtimeRoot, ppt.localPath), "utf8");
      assert.match(pptFile, /Operating Systems - Lecture 01/);
      assert.equal(Array.isArray(ppt?.metaJson.slideTimeline), true);
      assert.equal((ppt?.metaJson.slideTimeline as Array<{ timeSec: number }>)?.[1]?.timeSec, 82.37);

      const video = snapshot.courseResources.find((resource) => resource.resourceType === "video");
      assert.match(video?.url || "", /clientUUID=/);
      assert.match(video?.url || "", /t=user-1-/);

      const subtitle = snapshot.courseResources.find((resource) => resource.resourceType === "subtitle");
      const notes = snapshot.courseResources.find((resource) => resource.resourceType === "notes");
      assert.ok(subtitle?.localPath);
      assert.ok(notes?.localPath);
      const subtitleFile = await readFile(path.join(runtimeRoot, subtitle.localPath), "utf8");
      const notesFile = await readFile(path.join(runtimeRoot, notes.localPath), "utf8");
      assert.match(subtitleFile, /Welcome to OS/);
      assert.match(notesFile, /\[00:00:00\] Welcome to OS/);
    });
  });

  test("logs in with username/password before syncing MSA subtitles", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    await repo.writeCourses([
      {
        id: "course-byxt-ai",
        stableKey: "2026-spring:buaa-byxt:ai-1",
        title: "Artificial Intelligence",
        teacher: "Prof. Zhang",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "BYXT-AI-1",
        status: "active",
        displayColor: null,
        metadata: {
          stableKeyHints: ["artificial intelligence|prof. zhang"],
          sourceAliases: {
            "buaa-byxt": "BYXT-AI-1",
          },
        },
      },
    ]);

    await withTestServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/yjapi/casapi/index.php") {
        assert.equal(url.searchParams.get("r"), "auth/login");
        assert.equal(url.searchParams.get("tenant_code"), "21");

        if (url.searchParams.get("ticket")) {
          assert.match(String(request.headers.cookie || ""), /PHPSESSID=msa-prelogin/);
          response.writeHead(302, {
            location: "/classroom/courseCenter",
            "set-cookie": ["_token=password-token; Path=/"],
          });
          response.end();
          return;
        }

        if (url.searchParams.get("auType")) {
          assert.equal(url.searchParams.get("auType"), "cmc");
          assert.match(url.searchParams.get("forward") || "", /\/classroom\/courseCenter$/);
          response.writeHead(302, {
            location: `/yjapi/casapi/index.php?r=auth/login&tenant_code=21&forward=${encodeURIComponent(url.searchParams.get("forward") || "")}`,
            "set-cookie": [
              "PHPSESSID=msa-prelogin; Path=/",
              "tenant_code=21; Path=/",
              `temp_url=${encodeURIComponent(url.searchParams.get("forward") || "")}; Path=/`,
            ],
          });
          response.end();
          return;
        }

        assert.match(String(request.headers.cookie || ""), /PHPSESSID=msa-prelogin/);
        const service = `http://${request.headers.host}/yjapi/casapi/index.php?forward=${encodeURIComponent(url.searchParams.get("forward") || "")}&r=auth%2Flogin&tenant_code=21`;
        response.writeHead(302, {
          location: `/sso/login?service=${encodeURIComponent(service)}`,
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/sso/login") {
        const service = url.searchParams.get("service") || "";
        assert.match(service, /\/yjapi\/casapi\/index\.php\?/);
        assert.match(service, /r=auth%2Flogin|r=auth\/login/);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<form><input name="execution" value="exec-msa"></form>');
        return;
      }

      if (request.method === "POST" && url.pathname === "/sso/login") {
        const service = url.searchParams.get("service") || "";
        assert.match(service, /\/yjapi\/casapi\/index\.php\?/);
        assert.match(service, /r=auth%2Flogin|r=auth\/login/);
        const body = await parseFormBody(request);
        assert.equal(body.get("username"), "24182104");
        assert.equal(body.get("password"), "secret");
        const redirectUrl = new URL(service);
        redirectUrl.searchParams.set("ticket", "st-msa");
        response.writeHead(302, {
          location: redirectUrl.toString(),
          "set-cookie": ["CASTGC=test-castgc; Path=/"],
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/courseCenter") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": ["_token=password-token; Path=/"],
        });
        response.end("<html><body>MSA</body></html>");
        return;
      }

      const auth = request.headers.authorization;
      if (!auth || auth !== "Bearer password-token") {
        response.writeHead(401);
        response.end("missing auth");
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/userapi/v1/infosimple") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 200, message: "ok", params: { id: "user-1", tenant_id: "tenant-1", phone: "13800138000" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/yjapi/courseapi/v3/multi-search/get-course-detail") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              course_title: "Artificial Intelligence",
              lecturer_name: "Prof. Zhang",
              sub_list: [{ id: "sub-ai-1", sub_title: "Week 1", sub_status: "6" }],
            },
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/courseapi/v3/portal-home-setting/get-sub-info") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              course_title: "Artificial Intelligence",
              sub_title: "Week 1",
              lecturer_name: "Prof. Zhang",
              resource_guid: "rg-ai-1",
            },
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/pptnote/v1/schedule/search-trans-result") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            list: [{ all_content: [{ BeginSec: 8, EndSec: 12, Text: "We define search as state-space exploration." }] }],
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/pptnote/v1/schedule/search-ppt") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 0, msg: "success", list: [] }));
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await syncBuaaMsa(repo, {
        auth: { username: "24182104", password: "secret" },
        courseIds: ["course-ai"],
        term: "2026 Spring",
        baseUrls: {
          ssoBase: `${baseUrl}/sso`,
          yjapiBase: `${baseUrl}/yjapi`,
          classroomBase: `${baseUrl}/classroom`,
        },
      });

      assert.equal(result.importedCourses, 1);
      assert.equal(result.importedItems, 1);
      assert.equal(result.importedResources, 2);

      const snapshot = await repo.readSnapshot();
      assert.match(String(snapshot.connections[0].auth.cookie || ""), /_token=password-token/);
      assert.equal(snapshot.connections[0].auth.username, "24182104");
      assert.equal(snapshot.connections[0].auth.password, "secret");
      const subtitle = snapshot.courseResources.find((resource) => resource.resourceType === "subtitle");
      assert.ok(subtitle?.localPath);
      const subtitleFile = await readFile(path.join(runtimeRoot, subtitle.localPath), "utf8");
      assert.match(subtitleFile, /state-space exploration/);
    });
  });

  test("skips msa courses that do not match an existing byxt timetable course", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    await repo.ensureScaffold();
    await repo.writeCourses([
      {
        id: "course-byxt-1",
        stableKey: "2026-spring:buaa-byxt:course-1",
        title: "Discrete Mathematics",
        teacher: "[theory] Prof. Sun",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "BYXT-1",
        status: "active",
        displayColor: null,
        metadata: {
          stableKeyHints: ["discrete mathematics|prof. sun"],
          sourceAliases: {
            "buaa-byxt": "BYXT-1",
          },
        },
      },
    ]);

    await withTestServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const auth = request.headers.authorization;

      if (!auth || auth !== "Bearer mock-token") {
        response.writeHead(401);
        response.end("missing auth");
        return;
      }

      if (request.method === "GET" && url.pathname === "/classroom/userapi/v1/infosimple") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 200, message: "ok", params: { id: 1, tenant_id: 21, phone: "13800138000" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/yjapi/courseapi/v3/multi-search/get-course-detail") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            msg: "success",
            data: {
              title: "Administrative Litigation Law",
              lecturer_name: "Prof. Bi",
              sub_list: [],
            },
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await syncBuaaMsa(repo, {
        auth: {
          token: "mock-token",
          account: "25373078",
        },
        courseIds: ["106798"],
        baseUrls: {
          yjapiBase: `${baseUrl}/yjapi`,
          classroomBase: `${baseUrl}/classroom`,
        },
      });

      const snapshot = await repo.readSnapshot();
      assert.equal(result.importedCourses, 0);
      assert.equal(snapshot.courses.length, 1);
      assert.equal(snapshot.courseItems.length, 0);
    });
  });
});
