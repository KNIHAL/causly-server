import { describe, expect, it } from "vitest";
import { isPathDenied } from "../tools/pathRules.js";

// P0-06: protected-path rules (pure string rules, run on every OS). The real-filesystem part is in pathGuard.test.js.
const HOME = "/home/me";
const WIN_HOME = "C:\\Users\\me";
const denied = (p, opts = {}) => isPathDenied(p, { home: HOME, ...opts }).denied;

describe("system directories (write is refused, read is allowed)", () => {
  it.each([
    "C:\\Windows",
    "C:\\Windows\\System32\\x.dll",
    "C:/Windows/System32",
    "c:\\WINDOWS\\system32",
    "C:\\Program Files (x86)\\App\\a.exe",
    "C:\\Users\\Public\\x.txt",
    "C:\\ProgramData\\x",
    "C:\\proj\\..\\..\\Windows\\x", // .. traversal
    "C:\\Windows.\\x", // trailing dot is ignored by Windows
    "C:\\Windows \\x", // trailing space is ignored by Windows
    "C:\\Windows...\\x",
    "\\\\?\\C:\\Windows\\x", // extended-length prefix
    "\\\\.\\C:\\Windows\\x", // device prefix
    "\\\\?\\UNC\\localhost\\C$\\Windows\\x",
    "\\\\localhost\\C$\\Windows\\System32", // admin share of this machine
    "\\\\127.0.0.1\\c$\\Windows",
    "/etc",
    "/etc/passwd",
    "/usr/local/bin/tool",
    "/bin/sh",
    "/sbin/init",
    "/boot/vmlinuz",
    "/System/Library/CoreServices/x",
    "/Library/Preferences/x",
    "/private/etc/hosts",
    "/home/me/../../etc/hosts",
    "/tmp/../etc/passwd",
  ])("refuses to write %s", (p) => {
    const result = isPathDenied(p, { home: HOME });
    expect(result.denied).toBe(true);
    expect(result.reason).toContain("protected system directory");
  });

  it.each([
    "C:\\Windows.old\\x", // sibling that only shares a prefix
    "C:\\WindowsApps\\x",
    "C:\\Program Files Extra\\x",
    "C:\\ProgramData2\\x",
    "C:\\Recovery2\\x",
    "D:\\causly-server\\tools\\fileOps.js",
    "D:\\Windows\\x",
    "/etcetera/x",
    "/usr2/x",
    "/Library2/x",
    "/home/me/project/x",
    "/tmp/x",
    "/var/tmp/x",
    "relative/path.txt",
  ])("allows writing %s", (p) => {
    expect(denied(p)).toBe(false);
  });

  it.each(["/etc/hosts", "/usr/share/doc/x", "C:\\Windows\\System32\\drivers\\etc\\hosts", "C:\\Program Files\\App\\readme.txt"])(
    "allows reading %s",
    (p) => {
      expect(denied(p, { access: "read" })).toBe(false);
    }
  );

  it("follows a Windows installed on another drive (SystemRoot, ProgramFiles)", () => {
    const env = { SystemRoot: "D:\\WinNT", ProgramFiles: "E:\\Apps" };
    expect(denied("D:\\WinNT\\system32\\x", { env })).toBe(true);
    expect(denied("E:\\Apps\\tool\\x", { env })).toBe(true);
    expect(denied("D:\\WinNT.bak\\x", { env })).toBe(false);
  });
});

describe("credential locations (read AND write are refused)", () => {
  it.each([
    "/home/me/.ssh",
    "/home/me/.ssh/id_rsa",
    "/home/me/.aws/credentials",
    "/home/me/.config/gcloud/credentials.db",
    "/home/me/Library/Keychains/login.keychain-db",
    "/home/me/.local/share/keyrings/login.keyring",
    "/Library/Keychains/System.keychain",
    "/System/Library/Keychains/x",
    "/Users/bob/.ssh/id_rsa", // another user's home
    "/home/alice/.aws/config",
    "/root/.ssh/authorized_keys",
    "/home/me/project/../.ssh/id_rsa",
    "C:\\Users\\me\\.ssh\\id_rsa",
    "C:\\Users\\me\\.aws\\credentials",
    "C:\\Users\\me\\.config\\gcloud\\x",
    "C:\\Users\\me\\AppData\\Roaming\\gcloud\\x",
    "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Credentials\\x",
    "C:\\Users\\me\\AppData\\Local\\Microsoft\\Vault\\x",
    "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Protect\\S-1-5-21\\key",
  ])("refuses %s for read and write", (p) => {
    for (const access of ["read", "write"]) {
      const result = isPathDenied(p, { home: HOME, access });
      expect(result.denied, `${access} ${p}`).toBe(true);
      expect(result.reason).toContain("protected");
    }
  });

  it("uses the real home directory it is given", () => {
    expect(denied("D:\\profiles\\me\\.ssh\\id_rsa", { home: "D:\\profiles\\me", access: "read" })).toBe(true);
    expect(denied("/srv/people/me/.aws/credentials", { home: "/srv/people/me", access: "read" })).toBe(true);
  });

  it.each([
    "/home/me/.sshx/x",
    "/home/me/ssh/x",
    "/home/me/.aws-notes/x",
    "/home/me/.config/other/x",
    "C:\\Users\\me\\.sshkeys\\x",
    "C:\\Users\\me\\Documents\\x",
  ])("does not touch the look-alike %s", (p) => {
    expect(denied(p, { access: "read" })).toBe(false);
    expect(denied(p, { access: "write" })).toBe(false);
  });
});

describe("Windows-only name tricks (refused for read and write)", () => {
  it.each([
    "D:\\work\\CON",
    "D:\\work\\nul",
    "D:\\work\\NUL.txt",
    "D:\\work\\com1",
    "D:\\work\\LPT9.log",
    "D:\\work\\aux",
    "D:\\work\\prn",
    "D:\\work\\CONIN$",
    "D:\\con\\file.txt",
  ])("reserved device name: %s", (p) => {
    for (const access of ["read", "write"]) {
      const result = isPathDenied(p, { access });
      expect(result.denied, `${access} ${p}`).toBe(true);
      expect(result.reason).toContain("reserved Windows device name");
    }
  });

  it.each(["D:\\work\\console.txt", "D:\\work\\connect", "D:\\work\\com10", "D:\\work\\nullable.js", "D:\\work\\auxiliary", "D:\\work\\scon"])(
    "ordinary name that only looks similar: %s",
    (p) => {
      expect(denied(p, { access: "write" })).toBe(false);
    }
  );

  it.each(["D:\\work\\file.txt::$DATA", "D:\\work\\file.txt:hidden", "D:\\work\\dir::$INDEX_ALLOCATION", "C:\\Windows\\x::$DATA"])(
    "NTFS alternate data stream: %s",
    (p) => {
      for (const access of ["read", "write"]) {
        expect(denied(p, { access }), `${access} ${p}`).toBe(true);
      }
    }
  );

  it.each(["\\\\.\\PhysicalDrive0", "\\\\.\\COM1", "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\x", "\\\\?\\Volume{1234}\\x"])(
    "device namespace: %s",
    (p) => {
      for (const access of ["read", "write"]) {
        expect(denied(p, { access }), `${access} ${p}`).toBe(true);
      }
    }
  );

  it("a colon is only allowed after the drive letter", () => {
    expect(denied("D:\\work\\file.txt")).toBe(false);
    expect(denied("d:/work/file.txt")).toBe(false);
  });
});

describe("input handling", () => {
  it("returns not denied for null and non-string input", () => {
    expect(isPathDenied(null)).toEqual({ denied: false });
    expect(isPathDenied(undefined)).toEqual({ denied: false });
    expect(isPathDenied(42)).toEqual({ denied: false });
    expect(isPathDenied("")).toEqual({ denied: false });
  });
});
