#!/usr/bin/env node
import React, { useEffect, useState } from "react";
import { Box, render, Text, useInput, useStdin } from "ink";
import { CommentsViewer } from "./App.js";
import { loadPrComments } from "./gh.js";
import type { CliOptions, LoadedPrComments } from "./types.js";

const HELP = `ghr - Read GitHub PR comments in a threaded Ink TUI

Usage:
  ghr
  ghr --pr 123
  ghr --repo owner/repo
  ghr --repo owner/repo --pr 123

Options:
  --pr <number>      PR number override
  --repo <o/r>       Repo override (owner/repo)
  -h, --help         Show help
`;

const CLEAR_TERMINAL = "\u001B[2J\u001B[3J\u001B[H";

function parseArgs(argv: string[]): { options: CliOptions; help: boolean } {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      return { options, help: true };
    }

    if (arg === "--pr") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --pr");
      }
      options.prNumber = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg.startsWith("--pr=")) {
      options.prNumber = Number.parseInt(arg.slice("--pr=".length), 10);
      continue;
    }

    if (arg === "--repo") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --repo");
      }
      options.repoOverride = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repoOverride = arg.slice("--repo=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.prNumber !== undefined && (!Number.isInteger(options.prNumber) || options.prNumber <= 0)) {
    throw new Error(`Invalid --pr value "${options.prNumber}"`);
  }

  return { options, help: false };
}

function Spinner({ label }: { label: string }): JSX.Element {
  const { isRawModeSupported } = useStdin();
  const frames = ["|", "/", "-", "\\"];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isRawModeSupported) {
      return () => undefined;
    }

    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % frames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [isRawModeSupported]);

  return <Text>{`${isRawModeSupported ? frames[index] : "-"} ${label}`}</Text>;
}

function ErrorScreen({ error, onExitRequest }: { error: string; onExitRequest: () => void }): JSX.Element {
  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (input === "q" || key.escape || (key.ctrl && input === "c")) {
        onExitRequest();
      }
    },
    { isActive: Boolean(isRawModeSupported) }
  );

  useEffect(() => {
    if (!isRawModeSupported) {
      onExitRequest();
    }
  }, [isRawModeSupported, onExitRequest]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="red">Failed to load PR comments.</Text>
      <Text>{error}</Text>
      <Text dimColor>{isRawModeSupported ? "Press q to quit." : "Exiting (non-interactive terminal)."}</Text>
    </Box>
  );
}

function Root({
  options,
  onExitRequest
}: {
  options: CliOptions;
  onExitRequest: () => void;
}): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LoadedPrComments | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const loaded = await loadPrComments(options);
        if (!cancelled) {
          setData(loaded);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [options]);

  if (loading) {
    return (
      <Box paddingX={1}>
        <Spinner label="Loading repository, PR context, and all comment threads via gh..." />
      </Box>
    );
  }

  if (error) {
    return <ErrorScreen error={error} onExitRequest={onExitRequest} />;
  }

  if (!data) {
    return <ErrorScreen error="No data returned." onExitRequest={onExitRequest} />;
  }

  return <CommentsViewer data={data} onExitRequest={onExitRequest} />;
}

function main(): void {
  let parsed: { options: CliOptions; help: boolean };
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error("");
    console.error(HELP);
    process.exit(1);
    return;
  }

  if (parsed.help) {
    console.log(HELP);
    process.exit(0);
    return;
  }

  let app: ReturnType<typeof render> | undefined;
  let exiting = false;
  const requestExit = (): void => {
    if (exiting) {
      return;
    }

    exiting = true;
    app?.unmount();
    if (process.stdout.isTTY) {
      process.stdout.write(CLEAR_TERMINAL);
    }
  };

  app = render(<Root options={parsed.options} onExitRequest={requestExit} />, {
    exitOnCtrlC: false
  });

  const handleSigint = (): void => {
    requestExit();
  };

  process.on("SIGINT", handleSigint);
  void app.waitUntilExit().finally(() => {
    process.off("SIGINT", handleSigint);
  });
}

main();
