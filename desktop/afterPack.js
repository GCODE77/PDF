// 빌드 후 실행 파일에 아이콘·정보를 넣는다 (c) 2026 GLORY KIM
const path = require('path');
exports.default = async function (ctx) {
  const m = await import('rcedit');
  const rcedit = m.default || m;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  await rcedit(exe, {
    icon: path.join(ctx.packager.projectDir, 'build', 'icon.ico'),
    'version-string': { ProductName: 'PDF 공작소', FileDescription: 'PDF 공작소', CompanyName: 'GLORY KIM', LegalCopyright: '\u00a9 2026 GLORY KIM. All rights reserved.', OriginalFilename: 'PDF 공작소.exe' },
  });
};
