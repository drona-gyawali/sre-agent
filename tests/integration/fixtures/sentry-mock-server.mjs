import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "sntryu_integration";
const HOST = `http://localhost:${PORT}`;

const organization = {
  id: "1",
  slug: "acme",
  name: "Acme",
  dateCreated: "2024-01-01T00:00:00.000Z",
};

const projects = [
  {
    id: "1",
    slug: "payments",
    name: "Payments",
    platform: "node",
    dateCreated: "2024-01-01T00:00:00.000Z",
  },
];

const issues = [
  {
    id: "1001",
    shortId: "PAY-1",
    title: "CardDeclinedError: payment failed for customer C-1001",
    culprit: "checkout.submit",
    status: "unresolved",
    level: "error",
    count: "42",
    userCount: 2,
    firstSeen: "2024-01-01T00:00:00.000Z",
    lastSeen: "2024-01-01T01:00:00.000Z",
    project: { id: "1", slug: "payments", name: "Payments" },
    metadata: { value: "card_declined" },
    permalink: `${HOST}/organizations/acme/issues/PAY-1/`,
  },
];

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${AUTH_TOKEN}`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", HOST);

  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { detail: "Invalid token" });
    return;
  }

  if (url.pathname === "/api/0/auth/") {
    sendJson(response, 200, {
      id: "1",
      name: "Integration User",
      email: "integration@example.com",
    });
    return;
  }

  if (url.pathname === "/api/0/organizations/acme/") {
    sendJson(response, 200, organization);
    return;
  }

  if (url.pathname === "/api/0/organizations/acme/projects/") {
    sendJson(response, 200, projects);
    return;
  }

  if (url.pathname === "/api/0/projects/acme/payments/") {
    sendJson(response, 200, projects[0]);
    return;
  }

  if (url.pathname === "/api/0/organizations/acme/issues/") {
    sendJson(response, 200, issues);
    return;
  }

  sendJson(response, 404, { detail: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock Sentry API listening on ${HOST}`);
});
