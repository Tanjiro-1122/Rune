import { Worker } from "node:worker_threads";
import ts from "typescript";

export type SupportedExecutionLanguage = "javascript" | "typescript";

export interface ExecutionLimits {
  timeoutMs: number;
  maxSourceLength: number;
  maxOutputChars: number;
  maxArtifacts: number;
  maxArtifactBytes: number;
  memoryLimitMb: number;
  maxWorkerRetries: number;
}

export interface CodeExecutionArtifact {
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
}

export interface CodeExecutionResult {
  available: boolean;
  language: SupportedExecutionLanguage;
  success: boolean;
  failureKind?: CodeExecutionFailureKind;
  failureGuidance?: string;
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  limits: ExecutionLimits;
  result?: string;
  resultType?: string;
  error?: string;
}

export type CodeExecutionFailureKind =
  | "disabled"
  | "empty_snippet"
  | "snippet_too_large"
  | "blocked_import_export"
  | "blocked_modules"
  | "blocked_host_global"
  | "blocked_network"
  | "blocked_runtime_api"
  | "compilation_error"
  | "timeout"
  | "worker_error"
  | "runtime_error";

interface WorkerSuccessMessage {
  ok: true;
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  result?: string;
  resultType?: string;
}

interface WorkerFailureMessage {
  ok: false;
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  error: string;
}

type WorkerMessage = WorkerSuccessMessage | WorkerFailureMessage;

interface WorkerPayload {
  script: string;
  timeoutMs: number;
  maxOutputChars: number;
  maxArtifacts: number;
  maxArtifactBytes: number;
}

const DEFAULT_LIMITS: ExecutionLimits = {
  timeoutMs: 5_000,
  maxSourceLength: 10_000,
  maxOutputChars: 12_000,
  maxArtifacts: 5,
  maxArtifactBytes: 24_000,
  memoryLimitMb: 64,
  maxWorkerRetries: 1,
};

export const SUPPORTED_ARTIFACT_MIME_TYPES = [
  "text/plain",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/xml",
  "application/json",
  "application/xml",
  "image/svg+xml",
] as const;

const SUPPORTED_ARTIFACT_MIME_TYPES_LIST = SUPPORTED_ARTIFACT_MIME_TYPES.join(", ");

const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const util = require("node:util");

const {
  script,
  timeoutMs,
  maxOutputChars,
  maxArtifacts,
  maxArtifactBytes,
} = workerData;

let consumedOutputChars = 0;
const logs = [];
const errors = [];
const artifacts = [];
const startedAt = Date.now();
const TRUNCATION_MARKER = "\\n...[truncated]";

function serialize(value) {
  if (typeof value === "string") return value;
  return util.inspect(value, {
    depth: 4,
    maxArrayLength: 50,
    breakLength: 80,
    compact: false,
  });
}

function getResultType(rawResult) {
  if (rawResult === null) return "null";
  if (Array.isArray(rawResult)) return "array";
  return typeof rawResult;
}

function clampText(text) {
  const remaining = maxOutputChars - consumedOutputChars;
  if (remaining <= 0) return "";
  if (text.length <= remaining) {
    consumedOutputChars += text.length;
    return text;
  }
  consumedOutputChars = maxOutputChars;
  return text.slice(0, Math.max(0, remaining - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
}

function pushLine(target, prefix, values) {
  const rendered = values.map((value) => serialize(value)).join(" ");
  const line = clampText(prefix + rendered);
  if (line) target.push(line);
}

const safeConsole = Object.freeze({
  log: (...args) => pushLine(logs, "", args),
  info: (...args) => pushLine(logs, "info: ", args),
  warn: (...args) => pushLine(errors, "warn: ", args),
  error: (...args) => pushLine(errors, "error: ", args),
});

function createArtifact(name, content, mimeType = "text/plain") {
  if (artifacts.length >= maxArtifacts) {
    throw new Error("Artifact limit reached for this execution.");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Artifacts require a non-empty string name.");
  }
  const ALLOWED_MIME_TYPES = ${JSON.stringify(SUPPORTED_ARTIFACT_MIME_TYPES)};
  if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      "Artifact MIME type not supported. Allowed: ${SUPPORTED_ARTIFACT_MIME_TYPES_LIST}."
    );
  }
  const normalizedContent =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  const bytes = Buffer.byteLength(normalizedContent, "utf8");
  if (bytes > maxArtifactBytes) {
    throw new Error(
      "Artifact exceeds the per-artifact size limit for this deployment."
    );
  }
  artifacts.push({
    name: name.trim(),
    mimeType,
    content: normalizedContent,
    bytes,
  });
  return artifacts[artifacts.length - 1];
}

const sandbox = {
  console: safeConsole,
  Math,
  Date,
  JSON,
  Number,
  String,
  Boolean,
  Array,
  Object,
  RegExp,
  Map,
  Set,
  BigInt,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  Promise,
  setTimeout,
  clearTimeout,
  createArtifact,
};

const context = vm.createContext(sandbox, {
  codeGeneration: { strings: false, wasm: false },
});

(async () => {
  try {
    const compiled = new vm.Script(script, {
      filename: "jarvis-sandbox.js",
      displayErrors: true,
    });

    const rawResult = await Promise.resolve(
      compiled.runInContext(context, {
        timeout: timeoutMs,
        displayErrors: true,
      })
    );

    const result = rawResult === undefined ? undefined : serialize(rawResult);
    const resultType = getResultType(rawResult);

    parentPort.postMessage({
      ok: true,
      durationMs: Date.now() - startedAt,
      logs,
      errors,
      artifacts,
      result,
      resultType,
    });
  } catch (error) {
    const rawMessage =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : String(error ?? "Execution failed inside the sandbox.");
    const message = rawMessage.includes("Script execution timed out")
      ? "Execution timed out after " + timeoutMs + " ms."
      : rawMessage;

    parentPort.postMessage({
      ok: false,
      durationMs: Date.now() - startedAt,
      logs,
      errors,
      artifacts,
      error: message,
    });
  }
})();
`;

function clampNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(Math.max(parsed, min), max));
}

function getExecutionLimits(): ExecutionLimits {
  return {
    timeoutMs: clampNumber(
      process.env.JARVIS_CODE_TIMEOUT_MS,
      DEFAULT_LIMITS.timeoutMs,
      250,
      30_000
    ),
    maxSourceLength: clampNumber(
      process.env.JARVIS_CODE_MAX_SOURCE_LENGTH,
      DEFAULT_LIMITS.maxSourceLength,
      200,
      50_000
    ),
    maxOutputChars: clampNumber(
      process.env.JARVIS_CODE_MAX_OUTPUT_CHARS,
      DEFAULT_LIMITS.maxOutputChars,
      500,
      80_000
    ),
    maxArtifacts: clampNumber(
      process.env.JARVIS_CODE_MAX_ARTIFACTS,
      DEFAULT_LIMITS.maxArtifacts,
      0,
      20
    ),
    maxArtifactBytes: clampNumber(
      process.env.JARVIS_CODE_MAX_ARTIFACT_BYTES,
      DEFAULT_LIMITS.maxArtifactBytes,
      512,
      200_000
    ),
    memoryLimitMb: clampNumber(
      process.env.JARVIS_CODE_MEMORY_LIMIT_MB,
      DEFAULT_LIMITS.memoryLimitMb,
      32,
      512
    ),
    maxWorkerRetries: clampNumber(
      process.env.JARVIS_CODE_MAX_WORKER_RETRIES,
      DEFAULT_LIMITS.maxWorkerRetries,
      0,
      2
    ),
  };
}

function sanitizeExecutionError(rawMessage: string) {
  return rawMessage
    .replace(
      /\b(?:sk-[a-z0-9_-]{20,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})\b/gi,
      "[redacted-secret]"
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY))\s*[:=]\s*[^\s,;]+/g,
      "$1=[redacted]"
    );
}

export function getCodeExecutionAvailability() {
  const limits = getExecutionLimits();
  const enabled = process.env.JARVIS_CODE_EXECUTION_ENABLED !== "false";

  if (!enabled) {
    return {
      available: false,
      reason:
        "sandboxed execution has been disabled with JARVIS_CODE_EXECUTION_ENABLED=false",
      limits,
    };
  }

  return {
    available: true,
    reason: null,
    limits,
  };
}

function validateSnippet(code: string, limits: ExecutionLimits) {
  if (!code.trim()) {
    return "Provide a non-empty JavaScript or TypeScript snippet.";
  }

  if (code.length > limits.maxSourceLength) {
    return `Snippet exceeds the ${limits.maxSourceLength}-character limit for this deployment.`;
  }

  const forbiddenPatterns: Array<[RegExp, string]> = [
    [
      /\bimport\s+.+from\b|\bimport\s*\(|\bexport\b/,
      "Imports and exports are not allowed in the sandbox.",
    ],
    [/\brequire\s*\(/, "Requiring external modules is not allowed in the sandbox."],
    [
      /\b(?:process|global|globalThis|window|document)\b/,
      "Access to host globals is blocked in the sandbox.",
    ],
    [
      /\b(?:Function|eval)\s*\(/,
      "Dynamic code generation is blocked in the sandbox.",
    ],
    [
      /\b(?:globalThis|window)\s*\[\s*["']eval["']\s*\]|\bthis\.constructor\.constructor\b/,
      "Dynamic code generation is blocked in the sandbox.",
    ],
    [
      /\b(?:__proto__|prototype)\b/,
      "Prototype mutation is blocked in the sandbox.",
    ],
    [
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/,
      "Network access is blocked in the sandbox.",
    ],
    [
      /\b(?:fs|child_process|worker_threads|cluster|dns|net|tls|http|https|Deno|Bun)\b/,
      "Filesystem, process, and runtime APIs are blocked in the sandbox.",
    ],
  ];

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(code)) {
      return message;
    }
  }

  return null;
}

function compileSnippet(
  code: string,
  language: SupportedExecutionLanguage
): { script: string } | { error: string } {
  const wrappedSnippet = `(async () => {\n${code}\n})()`;

  if (language === "javascript") {
    return { script: wrappedSnippet };
  }

  const transpiled = ts.transpileModule(wrappedSnippet, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      isolatedModules: true,
      esModuleInterop: false,
    },
    reportDiagnostics: true,
  });

  const diagnostics = transpiled.diagnostics ?? [];
  const firstError = diagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );

  if (firstError) {
    return {
      error: ts.flattenDiagnosticMessageText(firstError.messageText, "\n"),
    };
  }

  return { script: transpiled.outputText };
}

function getFailureDetails(
  errorMessage: string
): Pick<CodeExecutionResult, "failureKind" | "failureGuidance"> {
  if (/Execution timed out|Script execution timed out/.test(errorMessage)) {
    return {
      failureKind: "timeout",
      failureGuidance:
        "The snippet exceeded the runtime limit. Try smaller inputs or fewer iterations.",
    };
  }

  if (errorMessage.includes("non-empty JavaScript or TypeScript snippet")) {
    return {
      failureKind: "empty_snippet",
      failureGuidance:
        "Add executable JavaScript/TypeScript code and include `return` for a final value.",
    };
  }

  if (errorMessage.includes("character limit")) {
    return {
      failureKind: "snippet_too_large",
      failureGuidance:
        "Split the request into smaller snippets or reduce inline data to fit the source limit.",
    };
  }

  if (errorMessage.includes("Imports and exports are not allowed")) {
    return {
      failureKind: "blocked_import_export",
      failureGuidance:
        "Inline the required logic instead of using import/export statements.",
    };
  }

  if (errorMessage.includes("Requiring external modules is not allowed")) {
    return {
      failureKind: "blocked_modules",
      failureGuidance:
        "Use only built-in sandbox globals; external packages are intentionally blocked.",
    };
  }

  if (errorMessage.includes("Access to host globals is blocked")) {
    return {
      failureKind: "blocked_host_global",
      failureGuidance:
        "Do not reference process/window/global objects. Keep logic self-contained.",
    };
  }

  if (errorMessage.includes("Dynamic code generation is blocked")) {
    return {
      failureKind: "blocked_runtime_api",
      failureGuidance:
        "Avoid eval/Function constructors. Use direct deterministic code only.",
    };
  }

  if (errorMessage.includes("Prototype mutation is blocked")) {
    return {
      failureKind: "blocked_runtime_api",
      failureGuidance:
        "Do not mutate prototypes in the sandbox. Keep logic local and side-effect free.",
    };
  }

  if (errorMessage.includes("Network access is blocked")) {
    return {
      failureKind: "blocked_network",
      failureGuidance:
        "The sandbox has no outbound network access. Paste data directly into the snippet instead.",
    };
  }

  if (errorMessage.includes("Filesystem, process, and runtime APIs are blocked")) {
    return {
      failureKind: "blocked_runtime_api",
      failureGuidance:
        "Filesystem/process/runtime APIs are unavailable. Use pure in-memory logic only.",
    };
  }

  if (
    errorMessage.includes("Sandbox worker exited unexpectedly") ||
    errorMessage.includes("sandbox worker failed to start")
  ) {
    return {
      failureKind: "worker_error",
      failureGuidance:
        "This deployment could not complete the sandbox run. Retry once or reduce snippet complexity.",
    };
  }

  if (
    /Cannot find name\b/.test(errorMessage) ||
    /Property '[^']+' does not exist on type/.test(errorMessage) ||
    /Type '[^']+' is not assignable to type/.test(errorMessage)
  ) {
    return {
      failureKind: "compilation_error",
      failureGuidance:
        "Fix TypeScript errors in the snippet, or switch `language` to `javascript` for plain JS.",
    };
  }

  return {
    failureKind: "runtime_error",
    failureGuidance:
      "Review the error details and adjust the snippet. Keep code deterministic and self-contained.",
  };
}

function runWorker(
  payload: WorkerPayload,
  limits: ExecutionLimits
): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: payload,
      resourceLimits: {
        maxOldGenerationSizeMb: limits.memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(
          4,
          Math.min(16, Math.floor(limits.memoryLimitMb / 2))
        ),
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      void worker.terminate().then(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          durationMs: limits.timeoutMs,
          logs: [],
          errors: [],
          artifacts: [],
          error: `Execution timed out after ${limits.timeoutMs} ms.`,
        });
      });
    }, limits.timeoutMs + 100);

    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      callback();
    };

    worker.once("message", (message: WorkerMessage) => {
      finish(() => {
        if (settled) return;
        settled = true;
        resolve(message);
      });
    });

    worker.once("error", (error) => {
      finish(() => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });

    worker.once("exit", (code) => {
      finish(() => {
        if (settled || code === 0) return;
        settled = true;
        reject(new Error(`Sandbox worker exited unexpectedly with code ${code}.`));
      });
    });
  });
}

export async function executeSandboxedCode({
  code,
  language,
}: {
  code: string;
  language: SupportedExecutionLanguage;
}): Promise<CodeExecutionResult> {
  const { available, reason, limits } = getCodeExecutionAvailability();

  if (!available) {
    const unavailableMessage = `Sandboxed execution is unavailable because ${reason}.`;
    return {
      available: false,
      language,
      success: false,
      failureKind: "disabled",
      failureGuidance:
        "Set JARVIS_CODE_EXECUTION_ENABLED=true in this deployment to re-enable sandboxed execution.",
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: unavailableMessage,
    };
  }

  const validationError = validateSnippet(code, limits);
  if (validationError) {
    return {
      available: true,
      language,
      success: false,
      ...getFailureDetails(validationError),
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: validationError,
    };
  }

  const compiled = compileSnippet(code, language);
  if ("error" in compiled) {
    return {
      available: true,
      language,
      success: false,
      ...getFailureDetails(compiled.error),
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: compiled.error,
    };
  }

  try {
    let message: WorkerMessage | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= limits.maxWorkerRetries; attempt++) {
      try {
        message = await runWorker(
          {
            script: compiled.script,
            timeoutMs: limits.timeoutMs,
            maxOutputChars: limits.maxOutputChars,
            maxArtifacts: limits.maxArtifacts,
            maxArtifactBytes: limits.maxArtifactBytes,
          },
          limits
        );
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= limits.maxWorkerRetries) {
          throw error;
        }
      }
    }

    if (!message) {
      throw lastError ?? new Error("The sandbox worker failed to return a result.");
    }

    if (!message.ok) {
      const sanitizedError = sanitizeExecutionError(message.error);
      return {
        available: true,
        language,
        success: false,
        ...getFailureDetails(sanitizedError),
        durationMs: message.durationMs,
        logs: message.logs,
        errors: message.errors,
        artifacts: message.artifacts,
        limits,
        error: sanitizedError,
      };
    }

    return {
      available: true,
      language,
      success: true,
      durationMs: message.durationMs,
      logs: message.logs,
      errors: message.errors,
      artifacts: message.artifacts,
      limits,
      result: message.result,
      resultType: message.resultType,
    };
  } catch (error) {
    const rawMessage =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : String(error ?? "The sandbox worker failed to start in this deployment.");
    const sanitized = sanitizeExecutionError(rawMessage);
    const message = sanitized.includes("Script execution timed out")
      ? `Execution timed out after ${limits.timeoutMs} ms.`
      : sanitized;

    return {
      available: true,
      language,
      success: false,
      ...getFailureDetails(message),
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: message,
    };
  }
}
