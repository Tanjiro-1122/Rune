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
  durationMs: number;
  logs: string[];
  errors: string[];
  artifacts: CodeExecutionArtifact[];
  limits: ExecutionLimits;
  result?: string;
  resultType?: string;
  error?: string;
}

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
  timeoutMs: 2_000,
  maxSourceLength: 6_000,
  maxOutputChars: 8_000,
  maxArtifacts: 3,
  maxArtifactBytes: 12_000,
  memoryLimitMb: 64,
};

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
  if (
    typeof mimeType !== "string" ||
    (!mimeType.startsWith("text/") && mimeType !== "application/json")
  ) {
    throw new Error(
      "Artifacts must use a text/* or application/json MIME type."
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
      10_000
    ),
    maxSourceLength: clampNumber(
      process.env.JARVIS_CODE_MAX_SOURCE_LENGTH,
      DEFAULT_LIMITS.maxSourceLength,
      200,
      20_000
    ),
    maxOutputChars: clampNumber(
      process.env.JARVIS_CODE_MAX_OUTPUT_CHARS,
      DEFAULT_LIMITS.maxOutputChars,
      500,
      40_000
    ),
    maxArtifacts: clampNumber(
      process.env.JARVIS_CODE_MAX_ARTIFACTS,
      DEFAULT_LIMITS.maxArtifacts,
      0,
      10
    ),
    maxArtifactBytes: clampNumber(
      process.env.JARVIS_CODE_MAX_ARTIFACT_BYTES,
      DEFAULT_LIMITS.maxArtifactBytes,
      512,
      100_000
    ),
    memoryLimitMb: clampNumber(
      process.env.JARVIS_CODE_MEMORY_LIMIT_MB,
      DEFAULT_LIMITS.memoryLimitMb,
      32,
      256
    ),
  };
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
    return {
      available: false,
      language,
      success: false,
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: `Sandboxed execution is unavailable because ${reason}.`,
    };
  }

  const validationError = validateSnippet(code, limits);
  if (validationError) {
    return {
      available: true,
      language,
      success: false,
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
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: compiled.error,
    };
  }

  try {
    const message = await runWorker(
      {
        script: compiled.script,
        timeoutMs: limits.timeoutMs,
        maxOutputChars: limits.maxOutputChars,
        maxArtifacts: limits.maxArtifacts,
        maxArtifactBytes: limits.maxArtifactBytes,
      },
      limits
    );

    if (!message.ok) {
      return {
        available: true,
        language,
        success: false,
        durationMs: message.durationMs,
        logs: message.logs,
        errors: message.errors,
        artifacts: message.artifacts,
        limits,
        error: message.error,
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
    const message = rawMessage.includes("Script execution timed out")
      ? `Execution timed out after ${limits.timeoutMs} ms.`
      : rawMessage;

    return {
      available: true,
      language,
      success: false,
      durationMs: 0,
      logs: [],
      errors: [],
      artifacts: [],
      limits,
      error: message,
    };
  }
}
