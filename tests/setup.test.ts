import { describe, test, expect } from "bun:test";
import { describeSetupStep, formatSetupPlan, getSetupTargetLabels, ytDlpAssetName, type SetupPlan } from "../src/setup";
import { installHintsFor, manualInstallHintsFor } from "../src/utils/deps";

describe("ytDlpAssetName", () => {
  test("maps linux architectures to standalone binaries", () => {
    expect(ytDlpAssetName("linux", "x64")).toBe("yt-dlp_linux");
    expect(ytDlpAssetName("linux", "arm64")).toBe("yt-dlp_linux_aarch64");
  });

  test("maps macOS to the universal binary", () => {
    expect(ytDlpAssetName("darwin", "arm64")).toBe("yt-dlp_macos");
    expect(ytDlpAssetName("darwin", "x64")).toBe("yt-dlp_macos");
  });

  test("returns null for unsupported platforms and architectures", () => {
    expect(ytDlpAssetName("win32", "x64")).toBeNull();
    expect(ytDlpAssetName("linux", "ia32")).toBeNull();
  });
});

describe("install hints", () => {
  test("are platform-aware", () => {
    expect(installHintsFor("youtube", "darwin")[0]).toBe("brew install yt-dlp");
    expect(installHintsFor("youtube", "linux")[0]).toBe("outform install youtube");
    expect(installHintsFor("ffmpeg", "linux")).toContain("sudo apt install ffmpeg");
    expect(installHintsFor("whisper", "linux").join("\n")).toContain("-DGGML_NATIVE=OFF");
  });

  test("manual hints never point back at outform itself", () => {
    for (const target of ["youtube", "whisper", "ffmpeg", "claude", "codex"] as const) {
      for (const platform of ["darwin", "linux", "win32"] as const) {
        for (const hint of manualInstallHintsFor(target, platform)) {
          expect(hint.startsWith("outform ")).toBe(false);
        }
      }
    }
  });
});

describe("setup targets", () => {
  test("include ffmpeg and the all alias", () => {
    expect(getSetupTargetLabels()).toEqual(["youtube", "whisper", "ffmpeg", "claude", "codex", "all"]);
  });
});

describe("formatSetupPlan", () => {
  test("renders download steps with url and destination", () => {
    const plan: SetupPlan = {
      target: "youtube",
      name: "yt-dlp",
      command: "yt-dlp",
      purpose: "Enable YouTube extraction",
      installed: false,
      autoInstallCommand: null,
      steps: [
        {
          kind: "download",
          url: "https://example.com/yt-dlp",
          destination: "/usr/local/bin/yt-dlp",
          executable: true,
          label: "yt-dlp standalone binary",
        },
      ],
      manualHints: ["sudo apt install yt-dlp"],
    };

    const text = formatSetupPlan(plan);
    expect(text).toContain("Automatic install: download yt-dlp standalone binary");
    expect(text).toContain("https://example.com/yt-dlp");
    expect(text).toContain("/usr/local/bin/yt-dlp");
    expect(text).toContain("Manual install options");
    expect(text).toContain("sudo apt install yt-dlp");
  });

  test("renders multi-step plans as a list", () => {
    const plan: SetupPlan = {
      target: "whisper",
      name: "whisper.cpp",
      command: "whisper-cli",
      purpose: "Enable audio transcription fallback for YouTube",
      installed: false,
      autoInstallCommand: null,
      steps: [
        { kind: "command", command: ["brew", "install", "whisper-cpp"] },
        {
          kind: "download",
          url: "https://example.com/model.bin",
          destination: "/home/user/.cache/whisper/ggml-base.en.bin",
          executable: false,
          label: "whisper base.en model (142 MB)",
        },
      ],
      manualHints: ["brew install whisper-cpp"],
    };

    const text = formatSetupPlan(plan);
    expect(text).toContain("- brew install whisper-cpp");
    expect(text).toContain("- download whisper base.en model");
  });
});

describe("describeSetupStep", () => {
  test("joins command steps and describes downloads", () => {
    expect(describeSetupStep({ kind: "command", command: ["brew", "install", "ffmpeg"] })).toBe("brew install ffmpeg");
    expect(
      describeSetupStep({
        kind: "download",
        url: "https://example.com/x",
        destination: "/tmp/x",
        executable: true,
        label: "x binary",
      }),
    ).toBe("download x binary: https://example.com/x → /tmp/x");
  });
});
