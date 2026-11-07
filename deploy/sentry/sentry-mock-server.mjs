import { readFile } from "node:fs/promises";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "sntryu_local_dev";
const SEED_FILE = process.env.SENTRY_SEED_FILE ?? "/seed/data.json";
const HOST = `http://localhost:${PORT}`;

let seed;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSeed(value) {
  if (
    !isRecord(value) ||
    !isRecord(value.organization) ||
    typeof value.organization.slug !== "string" ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.issues)
  ) {
    throw new Error(
      "Sentry seed must contain organization, projects, and issues"
    );
  }

  return value;
}

async function loadSeed() {
  const raw = await readFile(SEED_FILE, "utf8");
  seed = validateSeed(JSON.parse(raw));
  return seed;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${AUTH_TOKEN}`;
}

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function issueHaystack(issue) {
  return JSON.stringify(issue).toLowerCase();
}

function issueTagValue(issue, key) {
  const tags = isRecord(issue.tags) ? issue.tags : {};

  switch (key) {
    case "is":
    case "status":
      return issue.status;
    case "level":
      return issue.level;
    case "project":
      return issue.project?.slug ?? issue.project?.id;
    case "message":
      return issue.title;
    case "url":
      return issue.permalink;
    case "transaction":
    case "culprit":
      return issue.culprit;
    default:
      return tags[key];
  }
}

function matchesFilter(issue, filter) {
  const value = issueTagValue(issue, filter.key);

  if (value === undefined || value === null) {
    return issueHaystack(issue).includes(filter.value);
  }

  return normalize(value).includes(filter.value);
}

function parseSearchQuery(query) {
  const filters = [];
  const phrases = [];
  const terms = [];
  const phrasePattern = /"([^"]+)"/g;
  let match;

  while ((match = phrasePattern.exec(query)) !== null) {
    const phrase = match[1].trim().toLowerCase();

    if (phrase) {
      phrases.push(phrase);
    }
  }

  const withoutPhrases = query.replace(phrasePattern, " ");

  for (const token of withoutPhrases.split(/\s+/)) {
    const trimmed = token.trim();

    if (!trimmed) {
      continue;
    }

    const upper = trimmed.toUpperCase();

    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      continue;
    }

    const separator = trimmed.indexOf(":");

    if (separator > 0 && separator < trimmed.length - 1) {
      filters.push({
        key: trimmed.slice(0, separator).toLowerCase(),
        value: trimmed.slice(separator + 1).toLowerCase(),
      });
      continue;
    }

    const term = trimmed.replace(/\*+$/g, "").toLowerCase();

    if (term) {
      terms.push(term);
    }
  }

  return { filters, phrases, terms };
}

function searchIssues(issues, query, projectParam) {
  const { filters, phrases, terms } = parseSearchQuery(query);

  return issues.filter((issue) => {
    if (
      projectParam &&
      issue.project?.slug !== projectParam &&
      issue.project?.id !== projectParam
    ) {
      return false;
    }

    if (!filters.every((filter) => matchesFilter(issue, filter))) {
      return false;
    }

    const haystack = issueHaystack(issue);

    if (!phrases.every((phrase) => haystack.includes(phrase))) {
      return false;
    }

    return terms.every((term) => haystack.includes(term));
  });
}

function findProject(organizationSlug, projectSlugOrId) {
  if (organizationSlug !== seed.organization.slug) {
    return undefined;
  }

  return seed.projects.find(
    (project) =>
      project.slug === projectSlugOrId || project.id === projectSlugOrId
  );
}

await loadSeed();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", HOST);

  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { detail: "Invalid token" });
    return;
  }

  if (url.pathname === "/seed" && request.method === "POST") {
    try {
      const loaded = await loadSeed();
      sendJson(response, 200, {
        organization: loaded.organization.slug,
        projects: loaded.projects.length,
        issues: loaded.issues.length,
      });
    } catch (error) {
      sendJson(response, 500, {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (url.pathname === "/api/0/auth/") {
    sendJson(response, 200, {
      id: "1",
      name: "Local Sentry User",
      email: "local-sentry@example.com",
    });
    return;
  }

  const organizationMatch = url.pathname.match(
    /^\/api\/0\/organizations\/([^/]+)\/?$/
  );

  if (organizationMatch) {
    if (organizationMatch[1] !== seed.organization.slug) {
      sendJson(response, 404, { detail: "Organization not found" });
      return;
    }

    sendJson(response, 200, seed.organization);
    return;
  }

  const projectsMatch = url.pathname.match(
    /^\/api\/0\/organizations\/([^/]+)\/projects\/?$/
  );

  if (projectsMatch) {
    if (projectsMatch[1] !== seed.organization.slug) {
      sendJson(response, 404, { detail: "Organization not found" });
      return;
    }

    sendJson(response, 200, seed.projects);
    return;
  }

  const projectMatch = url.pathname.match(
    /^\/api\/0\/projects\/([^/]+)\/([^/]+)\/?$/
  );

  if (projectMatch) {
    const project = findProject(projectMatch[1], projectMatch[2]);

    if (!project) {
      sendJson(response, 404, { detail: "Project not found" });
      return;
    }

    sendJson(response, 200, project);
    return;
  }

  const issuesMatch = url.pathname.match(
    /^\/api\/0\/organizations\/([^/]+)\/issues\/?$/
  );

  if (issuesMatch) {
    if (issuesMatch[1] !== seed.organization.slug) {
      sendJson(response, 404, { detail: "Organization not found" });
      return;
    }

    const query = url.searchParams.get("query") ?? "";
    const project = url.searchParams.get("project") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 0);
    const issues = searchIssues(seed.issues, query, project);

    sendJson(
      response,
      200,
      limit > 0 ? issues.slice(0, limit) : issues
    );
    return;
  }

  sendJson(response, 404, { detail: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local Sentry API listening on ${HOST}`);
});
