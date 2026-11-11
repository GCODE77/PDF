# PDF 공작소 — 세션 인수인계 (HANDOFF)

> 마지막 정리: 2026-11-09 · 현재 버전 **v1.6.3** · 이 문서만 읽어도 이어서 작업할 수 있도록 작성.
> 사용자와의 대화는 **항상 한국어**로 한다(영어로 답했다가 지적받은 적 있음). 사용자는 비개발자 관점에서 화면·동작을 캡처로 알려 주는 방식으로 피드백한다.

## 1. 한눈에
- 위치: `C:\Users\yg.kim\Documents\프로그램 제작\03_개인앱\PDF편집기` (빌드 없는 정적 PWA + Electron 설치본)
- 저장소: https://github.com/GCODE77/PDF (공개, Pages 배포 = https://gcode77.github.io/PDF/ , 릴리스에 설치 파일·ZIP)
- 보조 저장소: `GCODE77/GCODE77.github.io` (공개, **사용자 승인으로 생성**) — 소문자 `/pdf` 등 잘못된 주소를 `/PDF/` 로 이동시키는 안내 페이지만 있음
- 앱 이름 「PDF 공작소」, 저작권 「© 2026 GLORY KIM」, 아이콘은 사용자가 고른 3번(겹친 문서 + PDF 글자)
- 대상: 폰(안드로이드·아이폰, PWA) + PC(웹 / Windows 설치 앱). 모든 처리는 기기 안에서만(파일 업로드 없음)
- 개발 서버: `.claude/launch.json`의 `pdf-studio` (python http.server, 포트 8772). 브라우저 패널로 확인

## 2. 지금까지 만든 것 (버전별)
| 버전 | 내용 |
|---|---|
| 1.0 | 편집·변환·서명·압축·OCR·페이지 정리·검색·워터마크·암호 등 기본 기능, PWA, GitHub 공개 배포, 이름/아이콘 확정 |
| 1.1.0~1.1.2 | 홈(최근 파일·별표)·메뉴 막대, Electron 설치 앱, 새 버전 알림·자동 업데이트, 작업표시줄 아이콘(rcedit), 업데이트 EBUSY 수정 |
| 1.2.0 | 변환기(Word·PPT·엑셀·HTML·MD·TXT·CSV), **본문 글자 수정**, 교정, 양식, 도형·밑줄·취소선, 서명 글꼴, 1/2/4쪽 보기, Adobe식 메뉴·도구 패널, 문서 탭(닫기·이동), 기본 PDF 앱 안내 |
| 1.2.1 | 자동 업데이트 실행 실패(파일 잠김) 수정, Windows 기본 앱 목록 등록(HKCU Capabilities) |
| 1.3.0~1.3.1 | 본문 수정 서식(글꼴·크기·굵게·기울임·밑줄·취소선·색), 무료 글꼴 38종 |
| 1.3.2~1.3.3 | 구형 폰 브라우저 호환(최상위 await 제거)·시작 실패 안내, 창 닫기 버그(beforeunload), 서명 굵기 막대, Esc 대화상자 닫기, 404 안내 |
| 1.3.4~1.3.5 | 자동 업데이트 안정화(재시도·이유 안내·수동 설치 폴더), 설치 프로그램 한국어 문구 보정(OK→확인) |
| 1.3.6~1.3.7 | 홈 큰 버튼 「PDF ↔ 사진 변환」, **빈 페이지 찾기·삭제 + 파일철 구멍 자국 지우기** |
| 1.4.0 | 진행창 수정(대화상자 뒤에 가려져 있었음)·N/M장·퍼센트·남은 시간, **뒤집힌 쪽 자동 바로잡기**, **중복 쪽 제거**(합치기 옵션), 페이지 정리 확대(Ctrl 돋보기·휠·더블클릭) |
| 1.5.0 | **OCR 백그라운드 작업**(다른 문서 열어 작업 가능·병렬·임시저장·중지/취소), 쪽 패널 글자/그림 표시, 모든 긴 작업에 「중지·지금까지 적용」, 회전 후 보던 위치 유지 |
| 1.6.0 | **AI용 마크다운 변환**(구조·머리글/쪽번호 제거·스캔 OCR·나누기·여러 파일·클립보드) |
| 1.6.1 | 회전·삭제 등 다시 그릴 때 화면 깜빡임 제거(새 그림을 따로 그려 바꿔치기, 썸네일 유지) |
| 1.6.2 | 서명·사진을 마우스로 자유롭게 회전(위쪽 손잡이, Shift=15°, 「똑바로」), 저장 PDF에도 반영 |
| 1.6.3 | 회전 손잡이에 회전 모양 마우스 커서 |

## 3. 코드 지도 (`js/`)
- `main.js` 진입점. **문서 탭 관리**(`docs[]`, `activeId`, `stashActive/switchTo/closeTab`), `S.docId()`, `S.applyToDoc(docId, fn, {pages})`(보고 있지 않은 탭에도 결과 적용), 홈 카드, 저장/공유, 기본 앱 안내 대화상자, 단축키
- `state.js` 전역 상태 `S`, `h()`(DOM 헬퍼), `modal()`(Esc 닫기·스택), `busy(msg,{stoppable})`(진행창: N/M장 자동 파싱·퍼센트·ETA·중지/취소), `toast`
- `doc.js` 열기(암호 문서→이미지 사본), 실행 취소 이력, `applyBytes/flush/currentBytes`(편집 개체를 PDF에 굽는 `flat()`; 양식 필드는 `core2.addFormFields`)
- `viewer.js` 페이지 표시·6가지 보기 방식(single/scroll/two/twoscroll/four/fourscroll, 표지·간격), 편집 개체(텍스트·이미지·형광펜·밑줄·도형·교정·양식 칸·펜), **본문 수정 모드**(`buildEditLayer/startLineEdit`), 서식 막대, `build()`가 보던 쪽·위치 유지
- `side.js` 쪽 패널(썸네일+글자/그림 표시), 목차, 검색, **페이지 정리 화면**(돋보기·크기·더블클릭)
- `tools.js` 변환/OCR/압축/보안/워터마크/서명 등 대화상자 + `TOOLS`·`PANEL`(Adobe 구성). `tools2.js` 교정·양식·머리글·나누기·자르기·속성·이미지 추출·만들기·서명 요청 등 + `TOOLS2`
- `pdfcore.js` pdf-lib 래퍼: `flatten`(개체→PDF), `applyPlan`, `rasterRebuild`(중지 시 남은 쪽 원본 유지), 자체 `subsetFont`, `stripTextOps`(콘텐츠 스트림에서 글자 출력 명령 제거 = 본문 수정/교정의 핵심), `addInvisibleText`
- `core2.js` 머리글·자르기·나누기·속성·양식(listFormFields/fill/create)·`rasterizePages`
- `layout.js` **페이지 분석기**(글줄·문단·표(선/정렬)·그림, 글꼴 이름/굵기) — 변환기·본문 수정·AI 마크다운이 공유. `exporters.js` DOCX/PPTX/XLSX/HTML/MD/TXT/CSV 작성기, `analyzeAll`
- `aimd.js` AI용 마크다운(`convertPdfToMd`, `assemble`, 대화상자). `ocrjob.js` OCR 작업 관리(워커 풀 `makePool`, IndexedDB 임시저장, 작업 상자 UI, `pageHasText`)
- `blank.js` 빈 쪽/구멍 분석(`analyzeBlank`: 잉크 연결요소 + 가장자리 원형 덩어리=구멍), `orient.js` 방향(글자 방향 즉시 + 스캔은 OCR 비교), `dup.js` 중복(글자 해시 + 잉크 겹침)
- `textfonts.js`(문서 글자용 글꼴: 표시·저장·기준선 `baseOf`), `sigfonts.js`(서명용), `menubar.js`(Acrobat식 메뉴·하위 메뉴·테마·읽기 모드), `update.js`, `home.js`, `recent.js`
- `desktop/main.js` Electron 메인: `app://pdf/` 프로토콜, **자동 업데이트**(`install-update`: 3회 재시도·MZ 검사·spawn 재시도→openPath→cmd start→폴더 열기, `update.log`), `registerAssociations`(HKCU 기본 앱 등록), 창 닫기 확인(`will-prevent-unload`), 단일 인스턴스

## 4. 핵심 설계 메모
- **편집 모델**: 편집은 페이지 좌표(pt, 왼쪽 위 원점) 오버레이 개체(`S.overlays[pageIndex]`)로 쌓고 저장/구조 변경 때 `flatten`으로 PDF에 굽는다. 이력 스냅숏 `{bytes, ov}`.
- **본문 수정** = 화이트박스(`whiteout.edit`) + 새 텍스트 개체. flatten 때 `stripPageText`가 원본 글자 출력(Tj/TJ)을 실제 제거(글자가 줄 안에서 시작하는 것만). 교정(`redact`)도 같은 경로.
- **분석기**: pdf.js `getOperatorList`로 선/사각형/이미지 위치, `getTextContent`로 글줄. pdf.js가 끼워 넣는 공백 조각은 버리고 간격으로 재계산. 글꼴 이름은 `fontExtraProperties:true` 문서에서만 읽힌다.
- **OCR 작업**: 스냅숏 바이트를 별도 pdf.js 문서로 열어 워커 풀(최대 4, 폰 1)이 쪽 단위로 처리 → 쪽마다 IndexedDB 저장 → 끝나면 `S.applyToDoc`. 취소는 임시저장 유지, 중지는 그때까지 적용. 쪽 수가 바뀌면 적용 거부.
- **busy**: `#busy`는 z-index 90(모달 60보다 위). `{stoppable:true}`면 `b.stopped`를 작업이 확인해 부분 결과를 낸다(변환·압축·배경정리·빈쪽·중복·방향·이미지 추출).

## 5. 개발·검증 방법과 함정 (중요)
- **브라우저 패널이 숨겨지면** pdf.js 렌더·타이머가 멈춘다 → 검증 스크립트 첫 줄 `window.requestAnimationFrame = cb => setTimeout(cb,0)`, 긴 대기 전에 `tabs_select`, 한 호출은 45초 이내로 쪼갠다.
- **모듈 캐시**: 로컬에서 JS를 고친 뒤 같은 origin에서 reload 해도 이전 모듈이 남는 일이 잦다 → 서비스워커 해제·`caches` 삭제·`fetch(url,{cache:'reload'})` 후 **다른 URL(`?t=…` 또는 127.0.0.1)로 이동**해서 다시 열기. 그래도 안 되면 `import('/js/x.js?v='+Date.now())`로 직접 시험.
- 셸 도구의 **큰 heredoc(≈8KB↑)은 잘리고 `\\`가 `\`로 줄어든다**(정규식 `\n`이 실제 줄바꿈이 되어 문법 오류가 난 적 있음) → 긴 패치는 Write 도구로 `.py`를 만든 뒤 실행하고, 정규식 있는 JS는 Edit 도구로 고친다. JS 수정 뒤에는 항상 `node --check`.
- pdf-lib 최소화 빌드는 클래스 이름이 난독화돼 `constructor.name` 비교 불가 → `instanceof`.
- pdf.js constructPath 인자는 `[paintOp, [path데이터], minMax]`. pdf.js 5+의 `Uint8Array.toHex` 문제로 호환(legacy) 빌드를 vendor에 둠.
- 기존 CSS 클래스 충돌 주의: `.tn`(썸네일 번호, absolute), `.sw`(색 견본)와 새 요소가 겹친 적 있음.
- 변환 결과 Word/PPT/엑셀은 python-docx/python-pptx/openpyxl로 **구조만** 검증(실제 Office 렌더링은 못 봄).
- Electron 시험: `desktop/tests/`의 CDP 스크립트(`cdpcheck.mjs`, `regcheck.mjs`, `updtest.mjs`)가 설치본(win-unpacked)을 띄워 업데이트 흐름·기본 앱 등록을 확인(경로 수정 필요). **시험 때 사용자가 쓰는 앱을 죽이지 말 것**(`taskkill /IM` 대신 자신이 띄운 PID만 `/T`로 종료). 기본 앱 등록 시험 후엔 HKCU 흔적을 지운다.
- 릴리스 직전 점검표는 README 「새 버전 내는 방법」 참고. 설치 빌드 실패 시 **릴리스 금지**.

## 6. 사용자 요구·결정 사항 (대화에서 나온 것)
- 어도비 아크로벳처럼 직관적이고 폰·PC 둘 다. 사용자가 보낸 아크로벳 캡처(도구 목록, 보기→페이지 표시 등)는 **그대로 구현**하는 것이 원칙(도구 패널 순서·메뉴 구성).
- 공개 저장소 `PDF` 생성·Pages·릴리스 배포는 사용자 승인 사항. 추가 저장소(안내용)도 승인받고 만들었다. **새 저장소·외부 공개는 다시 확인**할 것.
- 서명 요청/주석 요청은 서버가 없어 「파일 주고받기」 방식임을 밝혔다(진행 추적 불가). 구글 드라이브 직접 연동은 OAuth 클라이언트 ID가 필요해 미구현(사용자에게 안내함, 보류).
- 단톡방 공유용 한 장 소개글을 만들어 준 적 있음(기능 변경 시 갱신 요청 가능).
- 사용자 PC 사정: 회사 PC(보안 프로그램·네트워크 차단 가능성). 자동 업데이트 실패 원인은 확정 못 함 → 실패 이유·`update.log`·수동 설치 폴더 열기로 대응.
- 문구 규칙: 버튼 이름은 실제 이름 그대로(「확인」, 「다시 시도」). 사용자가 짚어 준 사례: 설치 문구 「OK」.

## 7. 아직 확인하지 못했거나 열려 있는 것
- 사용자 PC의 **실제 대용량 스캔 문서(36쪽·462쪽·685쪽)**로 OCR·방향·중복·빈 쪽·AI 마크다운을 돌려 본 적 없음(시험용 문서로만 검증). 쪽당 처리 시간·정확도는 미확인.
- 설치 앱의 **실제 자동 업데이트 설치**, Windows 알림 토스트, 기본 앱 목록에 앱이 뜨는 화면, 폰(안드로이드·아이폰) 실기기 동작은 직접 못 봄.
- AI 마크다운의 목록 기호(•, 1.)·「제N조」 규칙, 표 머리행 판단은 실제 문서 검증 필요.
- 큰 문서에서 쪽 회전은 문서 전체를 다시 저장해 몇 초 걸림(메타 회전만 바꾸는 가벼운 방식은 미구현).
- 변환(DOCX 등)·압축 같은 긴 작업은 아직 화면을 막는다(OCR만 백그라운드). 다른 작업도 백그라운드화할지는 사용자 요구가 있으면 검토.
- 다음 후보: OCR 결과로 한 번에 「OCR→방향→빈쪽→중복」 정리 마법사, 구글 드라이브 연동(클라이언트 ID 필요), 대용량 문서 성능 측정.

## 8. 자주 쓰는 명령
```bash
# 문법 확인(JS 수정 후)
cp js/파일.js /tmp/x.mjs && node --check /tmp/x.mjs
# 설치 파일 빌드(영문 임시 폴더에서) — 실패 시 몇 초 뒤 재시도
python desktop/build.py
# 릴리스(빌드·버전 확인 후)
gh release create vX.Y.Z /tmp/PDF-Gongjakso-Setup.exe <오프라인ZIP> --repo GCODE77/PDF --title "PDF 공작소 vX.Y.Z" --latest --notes "..."
```
