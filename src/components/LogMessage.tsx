import { Fragment, useState, type ReactNode } from "react";

interface LogMessageProps {
  message: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const MESSAGE_TOKEN_REGEX = /(https?:\/\/[^\s]+)|(\b\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[ap]\.\s*m\.)|(\[[^\]]+\])|(\{[^{}\n]+\})|(\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ALL)\b)|(\b(?:LOG|INFO|WARN|ERROR|DEBUG|TRACE|VERBOSE)\b)|(\+\d+ms\b)/g;
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ALL"]);
const LOG_LEVELS = new Set(["LOG", "INFO", "WARN", "ERROR", "DEBUG", "TRACE", "VERBOSE"]);

export function LogMessage({ message }: LogMessageProps) {
  const jsonValue = parseJsonMessage(message);
  const [isExpanded, setIsExpanded] = useState(false);

  if (jsonValue !== null) {
    return (
      <div className={`log-json-shell${isExpanded ? " is-expanded" : ""}`}>
        <button
          type="button"
          className={`log-json-toggle${isExpanded ? " is-expanded" : ""}`}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? "Collapse JSON" : "Expand JSON"}
        </button>
        {isExpanded ? (
          <pre className="log-json-pretty">
            <code>{renderPrettyJsonValue(jsonValue, 0, "root")}</code>
          </pre>
        ) : (
          <span className="log-json-inline">{renderCompactJsonValue(jsonValue, "root")}</span>
        )}
      </div>
    );
  }

  return <>{renderTextTokens(message)}</>;
}

function parseJsonMessage(message: string): JsonValue | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return null;
  }
}

function renderTextTokens(message: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let cursor = 0;

  for (const match of message.matchAll(MESSAGE_TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push(<Fragment key={`plain-${cursor}`}>{message.slice(cursor, index)}</Fragment>);
    }
    const token = match[0];
    tokens.push(renderToken(token, `token-${index}`));
    cursor = index + token.length;
  }

  if (cursor < message.length) {
    tokens.push(<Fragment key={`plain-${cursor}`}>{message.slice(cursor)}</Fragment>);
  }

  return tokens;
}

function renderToken(token: string, key: string) {
  if (token.startsWith("http://") || token.startsWith("https://")) {
    return (
      <a
        key={key}
        className="log-token-link"
        href={token}
        target="_blank"
        rel="noopener noreferrer"
      >
        {token}
      </a>
    );
  }

  if (token.startsWith("[") && token.endsWith("]")) {
    const inner = token.slice(1, -1);
    if (inner === "Nest") {
      return <span key={key} className="log-token-process">{token}</span>;
    }
    if (/\d{1,2}:\d{2}:\d{2}/.test(inner) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(inner)) {
      return <span key={key} className="log-token-inline-time">{token}</span>;
    }
    return <span key={key} className="log-token-context">{token}</span>;
  }

  if (/^\{[^{}\n]+\}$/.test(token)) {
    return <span key={key} className="log-token-route">{token}</span>;
  }

  if (HTTP_VERBS.has(token)) {
    return <span key={key} className="log-token-verb">{token}</span>;
  }

  if (LOG_LEVELS.has(token)) {
    return (
      <span
        key={key}
        className={`log-token-level log-token-level-${token.toLowerCase()}`}
      >
        {token}
      </span>
    );
  }

  if (token.startsWith("+") && token.endsWith("ms")) {
    return <span key={key} className="log-token-duration">{token}</span>;
  }

  return <span key={key} className="log-token-inline-time">{token}</span>;
}

function renderCompactJsonValue(value: JsonValue, key: string): ReactNode {
  if (value === null) {
    return <span key={key} className="log-token-json-null">null</span>;
  }

  if (typeof value === "string") {
    return <span key={key} className="log-token-json-string">"{value}"</span>;
  }

  if (typeof value === "number") {
    return <span key={key} className="log-token-json-number">{String(value)}</span>;
  }

  if (typeof value === "boolean") {
    return <span key={key} className="log-token-json-boolean">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <Fragment key={key}>
        <span className="log-token-json-punctuation">[</span>
        {value.map((item, index) => (
          <Fragment key={`${key}-item-${index}`}>
            {index > 0 ? <span className="log-token-json-punctuation">, </span> : null}
            {renderCompactJsonValue(item, `${key}-${index}`)}
          </Fragment>
        ))}
        <span className="log-token-json-punctuation">]</span>
      </Fragment>
    );
  }

  const entries = Object.entries(value);
  return (
    <Fragment key={key}>
      <span className="log-token-json-punctuation">{"{"}</span>
      {entries.map(([entryKey, entryValue], index) => (
        <Fragment key={`${key}-${entryKey}`}>
          {index > 0 ? <span className="log-token-json-punctuation">, </span> : null}
          <span className="log-token-json-key">"{entryKey}"</span>
          <span className="log-token-json-punctuation">: </span>
          {renderCompactJsonValue(entryValue, `${key}-${entryKey}-value`)}
        </Fragment>
      ))}
      <span className="log-token-json-punctuation">{"}"}</span>
    </Fragment>
  );
}

function renderPrettyJsonValue(value: JsonValue, depth: number, key: string): ReactNode {
  if (value === null) {
    return <span key={key} className="log-token-json-null">null</span>;
  }

  if (typeof value === "string") {
    return <span key={key} className="log-token-json-string">"{value}"</span>;
  }

  if (typeof value === "number") {
    return <span key={key} className="log-token-json-number">{String(value)}</span>;
  }

  if (typeof value === "boolean") {
    return <span key={key} className="log-token-json-boolean">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <Fragment key={key}>
          <span className="log-token-json-punctuation">[</span>
          <span className="log-token-json-punctuation">]</span>
        </Fragment>
      );
    }

    return (
      <Fragment key={key}>
        <span className="log-token-json-punctuation">[</span>
        {"\n"}
        {value.map((item, index) => (
          <Fragment key={`${key}-item-${index}`}>
            <span className="log-json-indent">{indent(depth + 1)}</span>
            {renderPrettyJsonValue(item, depth + 1, `${key}-${index}`)}
            {index < value.length - 1 ? <span className="log-token-json-punctuation">,</span> : null}
            {"\n"}
          </Fragment>
        ))}
        <span className="log-json-indent">{indent(depth)}</span>
        <span className="log-token-json-punctuation">]</span>
      </Fragment>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return (
      <Fragment key={key}>
        <span className="log-token-json-punctuation">{"{"}</span>
        <span className="log-token-json-punctuation">{"}"}</span>
      </Fragment>
    );
  }

  return (
    <Fragment key={key}>
      <span className="log-token-json-punctuation">{"{"}</span>
      {"\n"}
      {entries.map(([entryKey, entryValue], index) => (
        <Fragment key={`${key}-${entryKey}`}>
          <span className="log-json-indent">{indent(depth + 1)}</span>
          <span className="log-token-json-key">"{entryKey}"</span>
          <span className="log-token-json-punctuation">: </span>
          {renderPrettyJsonValue(entryValue, depth + 1, `${key}-${entryKey}-value`)}
          {index < entries.length - 1 ? <span className="log-token-json-punctuation">,</span> : null}
          {"\n"}
        </Fragment>
      ))}
      <span className="log-json-indent">{indent(depth)}</span>
      <span className="log-token-json-punctuation">{"}"}</span>
    </Fragment>
  );
}

function indent(depth: number) {
  return "  ".repeat(depth);
}
