"""
claude-harness-manager 실행 런처.

기존 `npm run dev`(dev 서버 2개: API 7860 + web 5173)를 GUI로 켜고/끄고
브라우저로 접속하게 해주는 tkinter 단일 창 런처. 표준 라이브러리만 사용한다.

설계 메모:
- npm은 Windows에서 npm.cmd(batch)다 → shutil.which로 절대경로를 찾아 호출.
- 종료는 taskkill /T로 프로세스 트리 전체를 죽인다(Popen.terminate()는 고아를 남김).
- 보강으로 Job Object(KILL_ON_JOB_CLOSE)에 자식을 할당해 런처 크래시 시 OS가 정리.
- tkinter 위젯은 메인 스레드 전용 → 로그는 백그라운드 스레드 readline → Queue → after 폴링.
- PyInstaller onefile에서 프로젝트 경로 기준은 sys.executable(부모)이다(__file__은 임시폴더).
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext

# --- 상수 ---
API_PORT = 7860
WEB_PORT = 5173
UI_URL = f"http://127.0.0.1:{WEB_PORT}"
CREATE_NO_WINDOW = 0x08000000  # 자식 콘솔창 숨김 (windowed exe에서 cmd 깜빡임 방지)
LOG_MAX_LINES = 1000
CONFIG_NAME = "launcher.json"

# 상태별 버튼 활성/색/라벨 (단일 출처)
STATES = {
    "STOPPED":  dict(start="normal",   stop="disabled", open="disabled", color="#888888", label="중지됨"),
    "STARTING": dict(start="disabled", stop="normal",   open="disabled", color="#d4a017", label="시작 중…"),
    "RUNNING":  dict(start="disabled", stop="normal",   open="normal",   color="#2e8b2e", label="실행 중"),
    "STOPPING": dict(start="disabled", stop="disabled", open="disabled", color="#d2691e", label="종료 중…"),
}


# ---------------------------------------------------------------------------
# 경로 결정 (PyInstaller onefile 함정 처리)
# ---------------------------------------------------------------------------
def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def app_dir() -> Path:
    """exe(또는 스크립트)가 실제로 놓인 디렉토리. 설정파일을 여기 둔다."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def looks_like_root(p: Path) -> bool:
    """package.json에 dev 스크립트가 있으면 이 프로젝트 루트로 간주."""
    pkg = p / "package.json"
    if not pkg.is_file():
        return False
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except Exception:
        return False
    return "dev" in (data.get("scripts") or {})


def load_saved_root() -> Path | None:
    cfg = app_dir() / CONFIG_NAME
    if not cfg.is_file():
        return None
    try:
        p = Path(json.loads(cfg.read_text(encoding="utf-8"))["project_root"])
        return p if looks_like_root(p) else None
    except Exception:
        return None


def save_root(p: Path) -> None:
    try:
        (app_dir() / CONFIG_NAME).write_text(
            json.dumps({"project_root": str(p)}, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def resolve_project_root() -> Path | None:
    # 1) frozen: exe 폴더가 곧 프로젝트 루트인 경우 (무설정 배치)
    cand = app_dir()
    if looks_like_root(cand):
        return cand
    # 2) dev 스크립트 실행: launcher/ 의 상위
    if not is_frozen():
        up = Path(__file__).resolve().parent.parent
        if looks_like_root(up):
            return up
    # 3) 저장된 경로
    return load_saved_root()


def ensure_root() -> Path | None:
    p = resolve_project_root()
    if p:
        return p
    messagebox.showinfo(
        "프로젝트 선택",
        "claude-harness-manager 프로젝트 폴더(package.json 위치)를 선택하세요.",
    )
    chosen = filedialog.askdirectory(title="프로젝트 루트 선택")
    if chosen and looks_like_root(Path(chosen)):
        save_root(Path(chosen))
        return Path(chosen)
    if chosen:
        messagebox.showerror("오류", "선택한 폴더에 유효한 package.json(dev 스크립트)이 없습니다.")
    return None


# ---------------------------------------------------------------------------
# 프로세스 시작/종료
# ---------------------------------------------------------------------------
def resolve_npm() -> str:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise FileNotFoundError("npm.cmd를 PATH에서 찾지 못했습니다. Node.js 설치를 확인하세요.")
    return npm


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _taskkill(pid: int, force: bool) -> int:
    args = ["taskkill", "/PID", str(pid), "/T"]
    if force:
        args.append("/F")
    try:
        return subprocess.run(
            args,
            creationflags=CREATE_NO_WINDOW,
            capture_output=True,
            text=True,
        ).returncode
    except Exception:
        return -1


def stop_dev(proc: subprocess.Popen | None, log) -> None:
    """프로세스 트리 전체를 종료. 정상(/T) 시도 후 강제(/F /T) 폴백."""
    if proc is None or proc.poll() is not None:
        return
    pid = proc.pid

    log(f"[launcher] 종료 요청 (taskkill /T PID={pid})")
    _taskkill(pid, force=False)
    try:
        # 콘솔 없는 프로세스는 graceful 신호가 잘 안 먹으므로 짧게만 기다리고 강제로 넘어간다
        proc.wait(timeout=1.5)
        log("[launcher] 정상 종료 완료")
        return
    except subprocess.TimeoutExpired:
        pass

    log(f"[launcher] 강제 종료 (taskkill /F /T PID={pid})")
    _taskkill(pid, force=True)
    try:
        proc.wait(timeout=5)
        log("[launcher] 강제 종료 완료")
    except subprocess.TimeoutExpired:
        log("[launcher][경고] 일부 프로세스가 남아있을 수 있습니다. 작업관리자를 확인하세요.")


def assign_kill_on_close_job(pid: int):
    """자식을 Job에 넣고, Job 핸들이 닫히면(=런처 종료/크래시) OS가 트리를 자동 종료.
    실패하면 None을 반환하고 taskkill 경로에만 의존한다."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.AssignProcessToJobObject.restype = wintypes.BOOL
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k32.SetInformationJobObject.restype = wintypes.BOOL
        k32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD,
        ]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]

        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        JobObjectExtendedLimitInformation = 9
        PROCESS_SET_QUOTA = 0x0100
        PROCESS_TERMINATE = 0x0001

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
                ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        hjob = k32.CreateJobObjectW(None, None)
        if not hjob:
            return None
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(
            hjob, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
        ):
            k32.CloseHandle(hjob)
            return None
        hproc = k32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, pid)
        if not hproc:
            k32.CloseHandle(hjob)
            return None
        ok = k32.AssignProcessToJobObject(hjob, hproc)
        k32.CloseHandle(hproc)
        if not ok:
            k32.CloseHandle(hjob)
            return None
        return hjob
    except Exception:
        return None


def close_handle(handle) -> None:
    if not handle:
        return
    try:
        import ctypes
        ctypes.WinDLL("kernel32").CloseHandle(handle)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------
class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.proc: subprocess.Popen | None = None
        self.hjob = None
        self.state = "STOPPED"
        self.q: "queue.Queue[str | None]" = queue.Queue(maxsize=10000)
        self.project_root: Path | None = None

        root.title("Harness Manager Launcher")
        root.geometry("580x440")
        root.minsize(500, 360)

        self._build_ui()
        self.set_state("STOPPED")

        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(100, self._drain)
        self.root.after(1000, self._health_tick)

        self.project_root = ensure_root()
        if self.project_root is None:
            self.log("[launcher] 프로젝트 루트를 찾지 못했습니다.")
            self.log("[launcher] exe를 프로젝트 폴더에 두거나, 다시 실행해 폴더를 선택하세요.")
            self.btn_start.config(state="disabled")
        else:
            self.log(f"[launcher] 프로젝트: {self.project_root}")
            self.log("[launcher] [시작]을 눌러 dev 서버를 실행하세요.")

    # --- UI 구성 ---
    def _build_ui(self) -> None:
        pad = dict(padx=10, pady=6)

        top = tk.Frame(self.root)
        top.pack(fill="x", **pad)
        self.canvas = tk.Canvas(top, width=18, height=18, highlightthickness=0)
        self.canvas.pack(side="left")
        self.lamp = self.canvas.create_oval(3, 3, 15, 15, fill="#888888", outline="")
        self.status_label = tk.Label(top, text="중지됨", anchor="w",
                                     font=("Segoe UI", 10, "bold"))
        self.status_label.pack(side="left", padx=10)

        btns = tk.Frame(self.root)
        btns.pack(fill="x", **pad)
        self.btn_start = tk.Button(btns, text="▶ 시작", width=10, command=self.on_start)
        self.btn_start.pack(side="left", padx=4)
        self.btn_stop = tk.Button(btns, text="■ 중지", width=10, command=self.on_stop)
        self.btn_stop.pack(side="left", padx=4)
        self.btn_open = tk.Button(btns, text="브라우저 열기", width=14, command=self.on_open)
        self.btn_open.pack(side="left", padx=4)

        logframe = tk.LabelFrame(self.root, text="로그")
        logframe.pack(fill="both", expand=True, **pad)
        self.text = scrolledtext.ScrolledText(
            logframe, height=15, state="disabled", font=("Consolas", 9), wrap="none"
        )
        self.text.pack(fill="both", expand=True)

    # --- 상태 ---
    def set_state(self, s: str) -> None:
        self.state = s
        m = STATES[s]
        self.btn_start.config(state=m["start"])
        self.btn_stop.config(state=m["stop"])
        self.btn_open.config(state=m["open"])
        self.canvas.itemconfig(self.lamp, fill=m["color"])
        self.status_label.config(text=f"{m['label']}   (API {API_PORT} / WEB {WEB_PORT})")

    # --- 로그 (큐 경유, thread-safe) ---
    def log(self, msg: str) -> None:
        try:
            self.q.put_nowait(msg)
        except queue.Full:
            pass

    def _drain(self) -> None:
        appended = False
        for _ in range(500):  # 한 틱당 처리 상한 (폭주 방어)
            try:
                item = self.q.get_nowait()
            except queue.Empty:
                break
            if item is None:
                continue  # EOF 마커
            self._append(item)
            appended = True
        if appended:
            self._trim()
            self.text.see("end")
        self.root.after(100, self._drain)

    def _append(self, line: str) -> None:
        self.text.configure(state="normal")
        self.text.insert("end", line + "\n")
        self.text.configure(state="disabled")

    def _trim(self) -> None:
        try:
            line_count = int(self.text.index("end-1c").split(".")[0])
        except Exception:
            return
        if line_count > LOG_MAX_LINES:
            self.text.configure(state="normal")
            self.text.delete("1.0", f"{line_count - LOG_MAX_LINES}.0")
            self.text.configure(state="disabled")

    # --- 액션 ---
    def on_start(self) -> None:
        if self.state != "STOPPED" or self.project_root is None:
            return
        try:
            npm = resolve_npm()
        except FileNotFoundError as e:
            messagebox.showerror("실행 불가", str(e))
            return
        env = os.environ.copy()
        env["NO_COLOR"] = "1"      # ANSI 컬러 escape 차단
        env["FORCE_COLOR"] = "0"
        self.log(f"[launcher] npm run dev 시작 — {self.project_root}")
        try:
            self.proc = subprocess.Popen(
                [npm, "run", "dev"],
                cwd=str(self.project_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env,
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception as e:
            messagebox.showerror("실행 실패", f"dev 서버 시작 실패:\n{e}")
            self.proc = None
            return
        self.hjob = assign_kill_on_close_job(self.proc.pid)
        self.set_state("STARTING")
        threading.Thread(target=self._read_loop, args=(self.proc,), daemon=True).start()

    def _read_loop(self, proc: subprocess.Popen) -> None:
        try:
            for line in iter(proc.stdout.readline, ""):
                self.log(line.rstrip("\r\n"))
        except Exception:
            pass
        finally:
            self.log(None)  # type: ignore[arg-type]  # EOF 마커

    def on_stop(self) -> None:
        if self.state not in ("STARTING", "RUNNING"):
            return
        self.set_state("STOPPING")
        proc = self.proc
        threading.Thread(target=self._stop_worker, args=(proc,), daemon=True).start()

    def _stop_worker(self, proc: subprocess.Popen | None) -> None:
        stop_dev(proc, self.log)
        self.root.after(0, self._after_stop)

    def _after_stop(self) -> None:
        close_handle(self.hjob)
        self.hjob = None
        self.proc = None
        self.set_state("STOPPED")

    def on_open(self) -> None:
        if self.state != "RUNNING" or not port_open(WEB_PORT):
            messagebox.showwarning("대기", "서버가 아직 실행 중이 아닙니다.")
            return
        webbrowser.open(UI_URL, new=2)

    # --- 헬스 폴링 ---
    def _health_tick(self) -> None:
        if self.state in ("STARTING", "RUNNING"):
            if self.proc is None or self.proc.poll() is not None:
                self.log("[launcher] dev 프로세스가 예기치 않게 종료되었습니다.")
                close_handle(self.hjob)
                self.hjob = None
                self.proc = None
                self.set_state("STOPPED")
            else:
                both_up = port_open(WEB_PORT) and port_open(API_PORT)
                if self.state == "STARTING" and both_up:
                    self.log("[launcher] 서버 준비 완료 — 실행 중")
                    self.set_state("RUNNING")
                elif self.state == "RUNNING" and not port_open(WEB_PORT):
                    self.set_state("STARTING")
        self.root.after(1000, self._health_tick)

    # --- 종료 ---
    def on_close(self) -> None:
        if self.state in ("STARTING", "RUNNING", "STOPPING"):
            if not messagebox.askyesno(
                "종료 확인", "dev 서버가 실행 중입니다.\n서버를 종료하고 런처를 닫을까요?"
            ):
                return
            self.set_state("STOPPING")
            self.root.update_idletasks()
            try:
                stop_dev(self.proc, lambda _m: None)
            except Exception:
                pass
            close_handle(self.hjob)
            self.hjob = None
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
