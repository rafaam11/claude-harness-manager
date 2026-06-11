# Harness Manager Launcher

claude-harness-manager의 dev 서버(`npm run dev`)를 GUI로 켜고/끄고, 버튼으로 브라우저 접속까지 해주는 tkinter 런처. Python 표준 라이브러리만 사용한다.

## 미리 알아둘 것

이 런처는 앱을 **실행만** 해줄 뿐 Node를 번들하지 않는다. 실행하는 PC에 **Node.js / npm이 설치돼 있어야** 한다(앱 자체가 Node 기반). exe로 빌드해도 마찬가지다.

## 바로 실행 (빌드 없이)

```
python launcher\launcher.py
```

창이 뜨면:
- **▶ 시작** — `npm run dev` 실행. 상태등이 노랑(시작 중) → 초록(실행 중)으로 바뀐다.
- **브라우저 열기** — http://127.0.0.1:5173 을 연다(실행 중일 때만 활성).
- **■ 중지** — 서버 프로세스 트리 전체를 종료한다.
- 하단 로그 영역에 server/web 출력이 실시간으로 흐른다.

## exe로 빌드

```
cd launcher
./build.ps1
```

- PyInstaller로 `--onefile --windowed` 단일 exe를 만든다.
- 결과물 `HarnessManagerLauncher.exe`가 **프로젝트 루트로 복사**된다.
- 루트에 둔 exe는 옆의 `package.json`을 자동 인식하므로 더블클릭만 하면 된다.
- (선택) `launcher/icon.ico`를 두면 exe 아이콘으로 적용된다.

## 프로젝트 경로 인식 방식

런처는 `npm run dev`를 돌릴 프로젝트 루트를 이 순서로 찾는다:

1. exe(또는 스크립트)가 놓인 폴더에 `package.json`(dev 스크립트 포함)이 있으면 그곳. → exe를 프로젝트 루트에 두면 무설정 동작.
2. 스크립트로 실행 시 `launcher/`의 상위 폴더.
3. 위가 안 되면 같은 폴더의 `launcher.json`에 저장된 경로.
4. 그래도 없으면 폴더 선택 창이 떠서 한 번 고르면 `launcher.json`에 기억한다.

## 동작 메모

- 종료는 `taskkill /T`로 프로세스 트리(npm → node → tsx/vite) 전체를 죽인다. 단순 종료로는 node가 고아로 남아 포트(7860/5173)를 점유한다.
- 보강으로 Windows Job Object에 자식을 묶어, 런처가 비정상 종료해도 OS가 트리를 정리한다.
- `--windowed` 빌드라 콘솔 창은 뜨지 않는다(자식 프로세스도 `CREATE_NO_WINDOW`로 숨김).
