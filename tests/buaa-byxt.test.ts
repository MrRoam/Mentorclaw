import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { syncBuaaByxt } from "../src/education/providers/buaa/byxt.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture, withTestServer } from "./helpers.ts";

const parseFormBody = async (request: import("node:http").IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const termsJsonGb18030 = Buffer.from([
  123, 34, 99, 111, 100, 101, 34, 58, 34, 48, 34, 44, 34, 100, 97, 116, 97, 115, 34, 58, 91, 123, 34, 105, 116, 101,
  109, 67, 111, 100, 101, 34, 58, 34, 50, 48, 50, 53, 45, 50, 48, 50, 54, 45, 50, 34, 44, 34, 105, 116, 101, 109,
  78, 97, 109, 101, 34, 58, 34, 50, 48, 50, 54, 180, 186, 188, 190, 34, 44, 34, 115, 101, 108, 101, 99, 116, 101,
  100, 34, 58, 116, 114, 117, 101, 125, 93, 125,
]);

const scheduleJsonGb18030 = Buffer.from([
  123, 34, 99, 111, 100, 101, 34, 58, 34, 48, 34, 44, 34, 100, 97, 116, 97, 115, 34, 58, 123, 34, 99, 111, 100, 101,
  34, 58, 34, 50, 48, 50, 53, 45, 50, 48, 50, 54, 45, 50, 34, 44, 34, 110, 97, 109, 101, 34, 58, 34, 50, 48, 50,
  54, 180, 186, 188, 190, 34, 44, 34, 97, 114, 114, 97, 110, 103, 101, 100, 76, 105, 115, 116, 34, 58, 91, 123,
  34, 99, 111, 117, 114, 115, 101, 67, 111, 100, 101, 34, 58, 34, 65, 73, 49, 48, 49, 34, 44, 34, 99, 111, 117,
  114, 115, 101, 78, 97, 109, 101, 34, 58, 34, 200, 203, 185, 164, 214, 199, 196, 220, 181, 188, 194, 219, 34, 44,
  34, 99, 111, 117, 114, 115, 101, 83, 101, 114, 105, 97, 108, 78, 111, 34, 58, 34, 48, 49, 34, 44, 34, 98, 101,
  103, 105, 110, 84, 105, 109, 101, 34, 58, 34, 48, 56, 58, 48, 48, 34, 44, 34, 101, 110, 100, 84, 105, 109, 101,
  34, 58, 34, 48, 57, 58, 51, 53, 34, 44, 34, 98, 101, 103, 105, 110, 83, 101, 99, 116, 105, 111, 110, 34, 58, 49,
  44, 34, 101, 110, 100, 83, 101, 99, 116, 105, 111, 110, 34, 58, 50, 44, 34, 112, 108, 97, 99, 101, 78, 97, 109,
  101, 34, 58, 34, 200, 253, 186, 197, 194, 165, 45, 50, 48, 49, 34, 44, 34, 119, 101, 101, 107, 115, 65, 110, 100,
  84, 101, 97, 99, 104, 101, 114, 115, 34, 58, 34, 181, 218, 49, 45, 49, 54, 214, 220, 91, 192, 237, 194, 219, 93,
  47, 213, 197, 211, 192, 183, 201, 91, 214, 247, 189, 178, 93, 34, 44, 34, 99, 111, 108, 111, 114, 34, 58, 34, 35,
  52, 52, 55, 55, 100, 100, 34, 44, 34, 100, 97, 121, 79, 102, 87, 101, 101, 107, 34, 58, 49, 125, 93, 125, 125,
]);

describe("syncBuaaByxt", () => {
  test("logs in with username/password and imports dated class items", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await withTestServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/sso/login") {
        assert.match(url.searchParams.get("service") || "", /\/byxt\/jwapp\/sys\/homeapp\/api\/home\/currentUser\.do$/);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          '<form id="loginForm">' +
            '<input type="hidden" name="execution" value="exec-123">' +
            '<input type="hidden" name="lt" value="LT-abc">' +
            '<input type="checkbox" name="rememberMe" value="on" checked>' +
            '<input type="hidden" name="_eventId" value="submit">' +
            '<input type="hidden" name="type" value="username_password">' +
            '<input type="submit" name="submit" value="LOGIN">' +
          "</form>",
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/sso/login") {
        const service = url.searchParams.get("service") || "";
        assert.match(service, /\/byxt\/jwapp\/sys\/homeapp\/api\/home\/currentUser\.do$/);
        const body = await parseFormBody(request);
        assert.equal(body.get("username"), "24182104");
        assert.equal(body.get("password"), "secret");
        assert.equal(body.get("lt"), "LT-abc");
        assert.equal(body.get("rememberMe"), "on");
        assert.equal(body.get("type"), "username_password");
        assert.equal(body.get("_eventId"), "submit");
        assert.equal(body.get("submit"), "LOGIN");
        response.writeHead(302, {
          location: `${service}?ticket=st-byxt`,
          "set-cookie": ["CASTGC=test-castgc; Path=/"],
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/uc/api/login") {
        response.writeHead(200, {
          "content-type": "text/plain",
          "set-cookie": ["uc_session=test-uc; Path=/"],
        });
        response.end("ok");
        return;
      }

      if (request.method === "GET" && url.pathname === "/uc/api/uc/status") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 0, data: { schoolid: "24182104", name: "Test User" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/currentUser.do") {
        const headers: Record<string, string[]> | Record<string, string> = {
          "content-type": "application/json; charset=utf-8",
        };
        if (url.searchParams.get("ticket") === "st-byxt") {
          headers["set-cookie"] = ["byxt_session=test-byxt; Path=/"];
        } else {
          assert.match(String(request.headers.cookie || ""), /byxt_session=test-byxt/);
        }
        response.writeHead(200, headers);
        response.end(JSON.stringify({ code: "0", data: { userCode: "24182104" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/student/schoolCalendars.do") {
        response.writeHead(200, { "content-type": "application/json; charset=gbk" });
        response.end(termsJsonGb18030);
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/getTermWeeks.do") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "0",
            datas: [
              { serialNumber: 1, startDate: "2026-02-23", endDate: "2026-03-01", name: "Week 1" },
              { serialNumber: 2, startDate: "2026-03-02", endDate: "2026-03-08", name: "Week 2" },
            ],
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do") {
        const body = await parseFormBody(request);
        assert.match(String(body.get("week") || ""), /^[12]$/);
        response.writeHead(200, { "content-type": "application/json; charset=gbk" });
        response.end(scheduleJsonGb18030);
        return;
        const week = body.get("week");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "0",
            datas: {
              code: "2025-2026-2",
              name: "2025-2026 Spring",
              arrangedList: [
                {
                  courseCode: "MATH101",
                  courseName: "Linear Algebra",
                  courseSerialNo: "01",
                  beginTime: "08:00",
                  endTime: "09:35",
                  beginSection: 1,
                  endSection: 2,
                  placeName: "J3-201",
                  weeksAndTeachers: "1-16周 [理论]/赵老师[主讲]",
                  color: "#4477dd",
                  dayOfWeek: 1,
                },
              ],
            },
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await syncBuaaByxt(repo, {
        auth: { username: "24182104", password: "secret" },
        baseUrls: {
          ssoBase: `${baseUrl}/sso`,
          ucBase: `${baseUrl}/uc`,
          byxtBase: `${baseUrl}/byxt`,
        },
      });

      assert.equal(result.importedCourses, 1);
      assert.equal(result.importedItems, 2);
      assert.equal(result.termCode, "2025-2026-2");

      const snapshot = await repo.readSnapshot();
      assert.equal(snapshot.connections.length, 1);
      assert.match(String(snapshot.connections[0].auth.cookie || ""), /CASTGC=test-castgc/);
      assert.equal(snapshot.connections[0].auth.password, "secret");
      assert.equal(snapshot.courses.length, 1);
      assert.equal(snapshot.courses[0].title, "人工智能导论");
      assert.equal(snapshot.courses[0].teacher, "张永飞");
      assert.equal(snapshot.courses[0].term, "2026春季");
      assert.equal(snapshot.courseItems.length, 2);
      assert.equal(snapshot.courseItems[0].type, "class");
      assert.equal(snapshot.courseItems[0].teacher, "张永飞");
      assert.equal(snapshot.courseItems[0].location, "三号楼-201");
      assert.equal(snapshot.courseItems[0].metaJson.weeksAndTeachers, "Week 1 张永飞");
      assert.match(snapshot.courseItems[0].startAt || "", /^2026-02-23T08:00:00\+08:00$/);
    });
  });

  test("hydrates a BYXT session before retrying the term list", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    let currentUserProbeCount = 0;
    let termRequestCount = 0;

    await withTestServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/sso/login" && url.searchParams.get("service")) {
        const service = url.searchParams.get("service") || "";
        if (!String(request.headers.cookie || "").includes("CASTGC=test-castgc")) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end('<form><input name="execution" value="exec-123"></form>');
          return;
        }
        response.writeHead(302, {
          location: `${service}${service.includes("?") ? "&" : "?"}ticket=st-1`,
        });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/sso/login") {
        const service = url.searchParams.get("service") || "";
        assert.match(service, /\/byxt\/jwapp\/sys\/homeapp\/api\/home\/currentUser\.do$/);
        response.writeHead(302, {
          location: `${service}${service.includes("?") ? "&" : "?"}ticket=st-1`,
          "set-cookie": ["CASTGC=test-castgc; Path=/"],
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/uc/api/login") {
        response.writeHead(200, {
          "content-type": "text/plain",
          "set-cookie": ["uc_session=test-uc; Path=/"],
        });
        response.end("ok");
        return;
      }

      if (request.method === "GET" && url.pathname === "/uc/api/uc/status") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 0, data: { schoolid: "24182104", name: "Test User" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/currentUser.do") {
        currentUserProbeCount += 1;
        const cookieHeader = request.headers.cookie || "";
        if (url.searchParams.get("ticket") === "st-1") {
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": ["byxt_session=ready; Path=/"],
          });
          response.end(JSON.stringify({ code: "0", data: { userCode: "24182104" } }));
          return;
        }
        if (!cookieHeader.includes("byxt_session=ready")) {
          const origin = `http://${request.headers.host}`;
          response.writeHead(302, {
            location: `/sso/login?service=${encodeURIComponent(`${origin}/byxt/jwapp/sys/homeapp/api/home/currentUser.do`)}`,
          });
          response.end();
          return;
        }
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ code: "0", data: { userCode: "24182104" } }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/student/schoolCalendars.do") {
        termRequestCount += 1;
        const cookieHeader = request.headers.cookie || "";
        if (!cookieHeader.includes("byxt_session=ready")) {
          response.writeHead(401, { "content-type": "text/plain" });
          response.end("unauthorized");
          return;
        }
        response.writeHead(200, { "content-type": "application/json; charset=gbk" });
        response.end(termsJsonGb18030);
        return;
      }

      if (request.method === "GET" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/getTermWeeks.do") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "0",
            datas: [{ serialNumber: 1, startDate: "2026-02-23", endDate: "2026-03-01", name: "Week 1" }],
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/byxt/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do") {
        response.writeHead(200, { "content-type": "application/json; charset=gbk" });
        response.end(scheduleJsonGb18030);
        return;
      }

      response.writeHead(404);
      response.end("not found");
    }, async (baseUrl) => {
      const result = await syncBuaaByxt(repo, {
        auth: { username: "24182104", password: "secret" },
        baseUrls: {
          ssoBase: `${baseUrl}/sso`,
          ucBase: `${baseUrl}/uc`,
          byxtBase: `${baseUrl}/byxt`,
        },
      });

      assert.equal(result.importedCourses, 1);
      assert.equal(termRequestCount, 1);
      assert.equal(currentUserProbeCount >= 1, true);
    });
  });
});
