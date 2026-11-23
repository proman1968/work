/**
 * Генератор 3 раздельных презентаций ODANT-WORK (ООО «БИС») в HTML (16:9) и PDF:
 *  1. Для клиентов:      assets/ODANT-WORK-clients-presentation.{html,pdf}
 *  2. Для франчайзеров:  assets/ODANT-WORK-franchise-presentation.{html,pdf}
 *  3. Для инвесторов:    assets/ODANT-WORK-investors-presentation.{html,pdf}
 *
 * Запуск: node license-server/scripts/build-presentations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../assets');
const docsDir = path.resolve(__dirname, '../../docs');

const logoPngPath = path.join(assetsDir, 'odant-logo.png');
const logoBase64 = fs.readFileSync(logoPngPath).toString('base64');
const logoDataUri = `data:image/png;base64,${logoBase64}`;

const BASE_CSS = `
    @page {
      size: 297mm 167mm;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-dark: #06101e;
      --bg-card-dark: #0d1d35;
      --bg-light: #f7fafd;
      --bg-white: #ffffff;
      --primary: #1d63dc;
      --primary-dark: #0a326e;
      --accent: #00b4d8;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --text-main: #0f1f33;
      --text-muted: #4b627d;
      --border: #d5e2f2;
      --border-strong: #b4cce8;
    }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
      color: var(--text-main);
      background: #0b1526;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media screen {
      body {
        padding: 18px 0 36px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 22px;
      }
      .slide {
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
        border-radius: 6px;
      }
      body.embed-single {
        padding: 0;
        margin: 0;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        justify-content: center;
        background: #060d18;
      }
      body.embed-single .slide {
        display: none;
        border-radius: 0;
      }
      body.embed-single .slide.active-slide {
        display: flex;
      }
    }
    @media print {
      body { background: #fff; padding: 0; display: block; }
    }
    .slide {
      width: 297mm;
      height: 167mm;
      position: relative;
      overflow: hidden;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 10.5mm 14.5mm 8.5mm;
      background: var(--bg-white);
      flex-shrink: 0;
    }
    .slide:last-of-type { page-break-after: auto; }
    .slide.dark {
      background: radial-gradient(circle at 85% 18%, #13356b 0%, #08182f 54%, #040b17 100%);
      color: #ffffff;
    }
    .slide:not(.dark)::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3.2mm;
      background: linear-gradient(90deg, var(--primary-dark) 0%, var(--primary) 55%, var(--accent) 100%);
    }
    .slide-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 3.8mm;
      border-bottom: 1.5px solid var(--border);
      padding-bottom: 2.8mm;
    }
    .slide.dark .slide-header { border-bottom-color: rgba(255, 255, 255, 0.16); }
    .header-left { max-width: 80%; }
    .kicker {
      display: inline-block;
      font-size: 8.3pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.11em;
      color: var(--primary);
      margin-bottom: 0.8mm;
    }
    .slide.dark .kicker { color: #38bdf8; }
    .slide-title {
      font-size: 18.2pt;
      font-weight: 800;
      color: var(--primary-dark);
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    .slide.dark .slide-title { color: #ffffff; }
    .slide-subtitle {
      font-size: 9.4pt;
      color: var(--text-muted);
      margin-top: 1mm;
      line-height: 1.32;
    }
    .slide.dark .slide-subtitle { color: #cbd5e1; }
    .badge-pill {
      background: #eaf2ff;
      border: 1px solid #bdd6ff;
      color: var(--primary-dark);
      font-size: 8.3pt;
      font-weight: 700;
      padding: 1.6mm 3.6mm;
      border-radius: 99px;
      white-space: nowrap;
    }
    .badge-pill.green { background: #d1fae5; border-color: #6ee7b7; color: #065f46; }
    .badge-pill.amber { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
    .badge-pill.dark-pill {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.45);
      color: #bae6fd;
    }
    .slide-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 3.4mm;
      min-height: 0;
    }
    .slide-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7.9pt;
      color: #6c849e;
      border-top: 1px solid #e3ecf7;
      padding-top: 2mm;
      margin-top: 2.4mm;
    }
    .slide.dark .slide-footer { border-top-color: rgba(255, 255, 255, 0.14); color: #93aecf; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.6mm; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3.2mm; }
    .col-60-40 { display: grid; grid-template-columns: 1.42fr 1fr; gap: 4.5mm; }
    .col-55-45 { display: grid; grid-template-columns: 1.2fr 1fr; gap: 4.5mm; }
    .card {
      background: var(--bg-light);
      border: 1px solid var(--border);
      border-radius: 2.8mm;
      padding: 3.2mm 3.8mm;
      display: flex;
      flex-direction: column;
      gap: 1.4mm;
    }
    .card.white { background: #ffffff; box-shadow: 0 2px 8px rgba(10, 54, 120, 0.04); }
    .card.accent-left { border-left: 4px solid var(--primary); }
    .card.green-left { border-left: 4px solid var(--accent-green); }
    .card.amber-left { border-left: 4px solid var(--accent-amber); }
    .card.dark-box {
      background: linear-gradient(135deg, #0a2344 0%, #123b72 100%);
      color: #fff;
      border: 1px solid #245596;
    }
    .card.dark-box .card-title { color: #7dd3fc; }
    .card.dark-box p, .card.dark-box li { color: #e2efff; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 2mm; }
    .card-title { font-size: 10.1pt; font-weight: 700; color: var(--primary-dark); line-height: 1.22; }
    .card p, .card li { font-size: 8.6pt; line-height: 1.35; color: var(--text-main); }
    .card ul { margin-left: 4mm; display: flex; flex-direction: column; gap: 0.9mm; }
    .tag {
      display: inline-block;
      font-size: 7.2pt;
      font-weight: 700;
      padding: 0.5mm 2mm;
      border-radius: 1.2mm;
      background: #e1edff;
      color: var(--primary-dark);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .tag.green { background: #d1fae5; color: #065f46; }
    .tag.amber { background: #fef3c7; color: #92400e; }
    .tag.dark { background: rgba(255, 255, 255, 0.16); color: #bae6fd; }
    table { width: 100%; border-collapse: collapse; font-size: 8.4pt; }
    th, td {
      border: 1px solid var(--border);
      padding: 1.7mm 2.5mm;
      text-align: left;
      vertical-align: middle;
      line-height: 1.28;
    }
    th { background: #ecf3fc; color: var(--primary-dark); font-weight: 700; }
    tr:nth-child(even) td { background: #fafcff; }
    .compact-table th, .compact-table td { padding: 1.35mm 2.2mm; font-size: 8pt; line-height: 1.24; }
    .banner {
      background: linear-gradient(90deg, #eef5ff 0%, #f5f9ff 100%);
      border: 1px solid #bfd6f6;
      border-left: 4.5px solid var(--primary);
      border-radius: 2.4mm;
      padding: 2.4mm 3.6mm;
      font-size: 8.9pt;
      line-height: 1.35;
      color: var(--text-main);
    }
    .banner.green-banner {
      background: linear-gradient(90deg, #ecfdf5 0%, #f4fef9 100%);
      border-color: #a7f3d0;
      border-left-color: var(--accent-green);
    }
    .banner.amber-banner {
      background: linear-gradient(90deg, #fffbeb 0%, #fef9e7 100%);
      border-color: #fcd34d;
      border-left-color: var(--accent-amber);
    }
    .banner strong { color: var(--primary-dark); }
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3.4mm; }
    .kpi-box {
      background: #f2f7ff;
      border: 1px solid #c9def8;
      border-radius: 2.6mm;
      padding: 2.7mm 3.3mm;
    }
    .kpi-num { font-size: 16.5pt; font-weight: 800; color: var(--primary); line-height: 1.05; margin-bottom: 0.8mm; }
    .kpi-label { font-size: 8.2pt; font-weight: 700; color: var(--primary-dark); line-height: 1.22; }
    .kpi-sub { font-size: 7.5pt; color: var(--text-muted); margin-top: 0.5mm; line-height: 1.22; }
    .flow-row { display: flex; align-items: stretch; justify-content: space-between; gap: 1.8mm; }
    .flow-step {
      flex: 1;
      background: #f4f8ff;
      border: 1px solid #c5dbf7;
      border-radius: 2.4mm;
      padding: 2.3mm 2.7mm;
    }
    .flow-step .step-num { font-size: 7.2pt; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 0.6mm; }
    .flow-step .step-title { font-size: 8.9pt; font-weight: 700; color: var(--primary-dark); margin-bottom: 0.6mm; }
    .flow-step p { font-size: 7.8pt; color: var(--text-muted); line-height: 1.28; }
    .flow-arrow { display: flex; align-items: center; justify-content: center; font-size: 12pt; font-weight: 800; color: var(--primary); padding: 0 0.4mm; }
    code {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 8pt;
      background: rgba(29, 99, 220, 0.09);
      color: #0b3c8a;
      padding: 0.2mm 1.2mm;
      border-radius: 1mm;
    }
    .dark code, .card.dark-box code { background: rgba(255, 255, 255, 0.14); color: #bae6fd; }
    .cover-main { display: grid; grid-template-columns: 1.32fr 1fr; gap: 7.5mm; align-items: center; flex: 1; }
    .cover-brand { display: flex; align-items: center; gap: 4mm; margin-bottom: 4.5mm; }
    .cover-logo { width: 18mm; height: 18mm; object-fit: contain; display: block; filter: drop-shadow(0 4px 12px rgba(0, 180, 216, 0.35)); }
    .footer-brand { display: inline-flex; align-items: center; gap: 2mm; font-weight: 600; }
    .footer-brand img { width: 4.8mm; height: 4.8mm; object-fit: contain; border-radius: 1mm; }
    .cover-brand-name { font-size: 25pt; font-weight: 900; letter-spacing: 0.03em; color: #ffffff; }
    .cover-brand-sub { font-size: 9.2pt; color: #38bdf8; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; }
    .cover-h1 { font-size: 22pt; font-weight: 800; line-height: 1.18; color: #ffffff; margin-bottom: 3.6mm; }
    .cover-h1 span { color: #38bdf8; }
    .cover-lead { font-size: 10.2pt; line-height: 1.44; color: #cbd5e1; margin-bottom: 4.8mm; }
    .cover-badges { display: flex; flex-wrap: wrap; gap: 2.2mm; }
    .cover-badge {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(125, 211, 252, 0.35);
      color: #e0f2fe;
      padding: 1.5mm 3mm;
      border-radius: 2mm;
      font-size: 8.2pt;
      font-weight: 600;
    }
    .cover-right-panel {
      background: rgba(13, 29, 55, 0.88);
      border: 1px solid rgba(56, 189, 248, 0.38);
      border-radius: 4mm;
      padding: 4.6mm;
      display: flex;
      flex-direction: column;
      gap: 3mm;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.45);
    }
    .cover-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.6mm; }
    .cover-stat {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: 2.4mm;
      padding: 2.5mm 2.9mm;
    }
    .cover-stat .val { font-size: 14.5pt; font-weight: 800; color: #38bdf8; line-height: 1.1; }
    .cover-stat .lbl { font-size: 7.8pt; color: #cbd5e1; margin-top: 0.8mm; line-height: 1.24; }
    .price-hero { font-size: 17.5pt; font-weight: 800; color: var(--primary); line-height: 1.05; white-space: nowrap; flex-shrink: 0; }
    .card.dark-box .price-hero { color: #38bdf8; }
`;

const DECK_SCRIPT = `
<script>
  (function () {
    const params = new URLSearchParams(window.location.search);
    const embed = params.get('embed') === '1';
    const slides = Array.from(document.querySelectorAll('.slide'));
    const initialSlide = Math.max(1, Math.min(slides.length, Number(params.get('slide')) || 1));
    let current = initialSlide;

    function showSlide(n) {
      current = Math.max(1, Math.min(slides.length, Number(n) || 1));
      slides.forEach((el, idx) => {
        el.classList.toggle('active-slide', idx + 1 === current);
      });
      if (!embed) {
        const target = slides[current - 1];
        if (target && params.get('slide')) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      if (window.parent && window.parent !== window) {
        const activeEl = slides[current - 1];
        window.parent.postMessage({
          type: 'odant-presentation-slide',
          slide: current,
          total: slides.length,
          section: activeEl ? activeEl.getAttribute('data-section') : 'product'
        }, '*');
      }
    }

    if (embed) {
      document.body.classList.add('embed-single');
      function fitSlide() {
        const active = document.querySelector('.slide.active-slide') || slides[0];
        if (!active) return;
        const sw = active.offsetWidth || 1122;
        const sh = active.offsetHeight || 631;
        const scale = Math.min(window.innerWidth / sw, window.innerHeight / sh);
        slides.forEach(s => {
          s.style.transform = 'scale(' + scale.toFixed(4) + ')';
          s.style.transformOrigin = 'center center';
        });
      }
      window.addEventListener('resize', fitSlide);
      showSlide(initialSlide);
      requestAnimationFrame(fitSlide);
    } else if (params.get('slide')) {
      showSlide(initialSlide);
    }

    window.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'odant-presentation-goto') {
        showSlide(d.slide);
      } else if (d.type === 'odant-presentation-step') {
        showSlide(current + (Number(d.delta) || 0));
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (embed) { e.preventDefault(); showSlide(current + 1); }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (embed) { e.preventDefault(); showSlide(current - 1); }
      } else if (e.key === 'Escape' && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'odant-presentation-close' }, '*');
      }
    });
  })();
</script>
`;

const footerHtml = (deckLabel, idx, total) => `
  <div class="slide-footer">
    <span class="footer-brand"><img src="${logoDataUri}" alt="ODANT"> ODANT-WORK · ООО «БИС»</span>
    <span>${deckLabel} · Слайд ${idx} / ${total}</span>
  </div>
`;

function wrapDeck({ title, deckLabel, slidesHtml }) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
${slidesHtml}
${DECK_SCRIPT}
</body>
</html>`;
}

/* ============================================================================
 * 1. ПРЕЗЕНТАЦИЯ ДЛЯ КЛИЕНТОВ (9 слайдов)
 * ============================================================================ */
function buildClientsPresentation() {
    const label = 'Презентация для клиентов';
    const total = 9;
    const slides = [
        // 1. Обложка
        `<section class="slide dark" data-slide="1" data-section="clients">
  <div class="cover-main">
    <div>
      <div class="cover-brand">
        <img class="cover-logo" src="${logoDataUri}" alt="ODANT">
        <div>
          <div class="cover-brand-name">ODANT<span style="color:#38bdf8;">·</span>WORK</div>
          <div class="cover-brand-sub">Решение для бизнеса и предприятий · ООО «БИС»</div>
        </div>
      </div>
      <h1 class="cover-h1">Единый контур учёта, документов и <span>приватных ИИ-сотрудников</span></h1>
      <p class="cover-lead">
        Все данные компании — бухгалтерский и управленческий учёт, первичные документы, встроенный офис, задачи,
        переписка и 13 ролевых ИИ-агентов — работают автономно на вашем сервере без утечки коммерческой тайны во внешние облака.
      </p>
      <div class="cover-badges">
        <span class="cover-badge">Реестр российского ПО № 3505</span>
        <span class="cover-badge">10 вечных лицензий в базе</span>
        <span class="cover-badge">Локальный ИИ 192 ГБ Unified RAM</span>
        <span class="cover-badge">Бесплатный старт через npx odant-work</span>
      </div>
    </div>
    <div class="cover-right-panel">
      <div style="font-size:9.5pt;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.08em;">Ключевые параметры для клиента</div>
      <div class="cover-stat-grid">
        <div class="cover-stat"><div class="val">5 000 000 ₽</div><div class="lbl">Готовый ПАК (Ryzen AI Max+ PRO 495 · 192 ГБ · 4 ТБ) + 10 вечных мест</div></div>
        <div class="cover-stat"><div class="val">4 000 000 ₽</div><div class="lbl">Базовая постоянная лицензия на 10 вечных мест для вашего сервера</div></div>
        <div class="cover-stat"><div class="val">13 агентов</div><div class="lbl">ИИ-консультант «?» в каждой форме, 26+ навыков и голосовой режим</div></div>
        <div class="cover-stat"><div class="val">15 мин</div><div class="lbl">Гарантия реакции Enterprise (24/7) в 1-й год поддержки из коробки</div></div>
      </div>
      <div style="background:rgba(56,189,248,0.12);border-left:3px solid #38bdf8;padding:2.5mm 3.2mm;border-radius:1.6mm;font-size:8.4pt;color:#e0f2fe;line-height:1.36;">
        <strong>Мгновенное включение после оплаты:</strong> оплата через ЮKassa или по безналичному счёту автоматически выпускает криптографические сертификаты <code>Ed25519</code> и включает все рабочие места без ручных перепрошивок.
      </div>
    </div>
  </div>
  ${footerHtml(label, 1, total)}
</section>`,

        // 2. Проблема и ответ
        `<section class="slide" data-slide="2" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">1. Вызов для современного бизнеса</div>
      <div class="slide-title">Конец «зоопарка» программ, Excel-таблиц и утечек в облака</div>
      <div class="slide-subtitle">Вместо склейки 5–7 разнородных сервисов и ручного переноса цифр сотрудники работают в едином защищённом пространстве</div>
    </div>
    <span class="badge-pill">Единая цифровая организация</span>
  </div>
  <div class="slide-body">
    <div class="grid-2">
      <div class="card amber-left white">
        <div class="card-head"><div class="card-title">Как устроено в большинстве компаний сейчас</div><span class="tag amber">Разрыв процессов</span></div>
        <ul>
          <li><strong>Учёт оторван от переписки:</strong> договоры и счета согласуются в мессенджерах и почте, а в учётную базу попадают вручную и с задержкой.</li>
          <li><strong>Файлы без контроля версий:</strong> Excel и Word разбросаны по личным папкам и внешним дискам.</li>
          <li><strong>Риск облачных ИИ:</strong> загрузка договоров, выручки и персональных данных в публичные LLM нарушает режим коммерческой тайны и 152-ФЗ.</li>
          <li><strong>Зависимость от вечной подписки:</strong> при остановке оплаты облачной ERP/CRM бизнес теряет доступ к собственной истории.</li>
        </ul>
      </div>
      <div class="card green-left white">
        <div class="card-head"><div class="card-title">Как работает ODANT-WORK</div><span class="tag green">1 система · 0 утечек</span></div>
        <ul>
          <li><strong>Единая модель данных:</strong> подразделения, справочники, документы, проводки, чаты и задачи связаны общими правами <code>BOSS / USER</code>.</li>
          <li><strong>Собственный контур:</strong> вся база (<code>work.db</code>), файлы и локальные модели ИИ живут внутри офиса компании — 100% суверенитет.</li>
          <li><strong>ИИ работает с фактами:</strong> кнопка <code>?</code> и 13 агентов видят реальные остатки, проводки и документы в пределах прав конкретного сотрудника.</li>
          <li><strong>Вечная базовая лицензия:</strong> 10 конкурентных мест принадлежат компании бессрочно и никогда не блокируются.</li>
        </ul>
      </div>
    </div>
    <div class="banner"><strong>Результат внедрения:</strong> сокращение ручного ввода и времени согласований до <strong>3–5×</strong>, прозрачный аудит каждого действия и полная сохранность корпоративных данных у собственника.</div>
  </div>
  ${footerHtml(label, 2, total)}
</section>`,

        // 3. Функциональный состав
        `<section class="slide" data-slide="3" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">2. Функциональный состав</div>
      <div class="slide-title">Учёт, встроенный офис, документооборот и процессы в одном окне</div>
      <div class="slide-subtitle">Готовая платформа на базе отечественной СУБД ODANT (ООО «БИС») без дополнительных лицензий на сторонние офисы</div>
    </div>
    <span class="badge-pill">Всё включено в базовый комплект</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card accent-left white">
        <div class="card-head"><div class="card-title">Встроенная система учёта</div><span class="tag">Двойная запись</span></div>
        <ul>
          <li>Типовой план счетов и справочники <code>/MODULES/Register</code></li>
          <li>Явная двойная запись; исправления строго через сторно</li>
          <li>Оборотно-сальдовая ведомость, Анализ и Обороты счёта, Журнал проводок</li>
          <li>Изолированные БД <code>work.db</code> по каждой организации холдинга</li>
        </ul>
      </div>
      <div class="card accent-left white">
        <div class="card-head"><div class="card-title">Офис и документы</div><span class="tag">Без Docker</span></div>
        <ul>
          <li>Встроенные редакторы <code>.xlsx</code> (формулы, листы), <code>.docx</code> (А4, таблицы) и <code>.pptx</code></li>
          <li>Прямое открытие в настольном Office (WebDAV LOCK/PUT)</li>
          <li>Версионность, архивация, поиск по текстам и структурам</li>
          <li>Шаблоны договоров, счетов, приказов и актов</li>
        </ul>
      </div>
      <div class="card accent-left white">
        <div class="card-head"><div class="card-title">Коммуникации и процессы</div><span class="tag">Роли BOSS/USER</span></div>
        <ul>
          <li>Единый проводник подразделений, задач и поручений</li>
          <li>Корпоративная почта, календарь, WebRTC-звонки и чат</li>
          <li>Контроль сроков, истории изменений и аудита в SQLite-логах</li>
          <li>Федерация серверов филиалов <code>NODES</code> с общим доступом</li>
        </ul>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-num">10 мест</div><div class="kpi-label">Вечная базовая лицензия</div><div class="kpi-sub">Конкурентные сессии — работают бессрочно</div></div>
      <div class="kpi-box"><div class="kpi-num">100%</div><div class="kpi-label">Автономность офиса</div><div class="kpi-sub">Не нужен внешний OnlyOffice или Google Docs</div></div>
      <div class="kpi-box"><div class="kpi-num">2 роли</div><div class="kpi-label">BOSS и USER</div><div class="kpi-sub">Наследование прав и рабочих мест LINKS</div></div>
      <div class="kpi-box"><div class="kpi-num">1 клик</div><div class="kpi-label">Бэкап организации</div><div class="kpi-sub">Выгрузка и перенос базы в .zip</div></div>
    </div>
  </div>
  ${footerHtml(label, 3, total)}
</section>`,

        // 4. ИИ-консультант и 13 агентов
        `<section class="slide" data-slide="4" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">3. ИИ-консультант и мультиагентная система</div>
      <div class="slide-title">13 ролевых ИИ-агентов действуют строго в рамках прав сотрудника</div>
      <div class="slide-subtitle">В каждой форме есть кнопка «?» и голосовой диалог (полный дуплекс на русском языке) — любая консультация фиксируется как задача</div>
    </div>
    <span class="badge-pill green">Включается базовой лицензией</span>
  </div>
  <div class="slide-body">
    <div class="col-55-45">
      <div class="card white">
        <div class="card-head"><div class="card-title">Ключевые роли агентской системы</div><span class="tag">13 ролей · 26+ навыков</span></div>
        <table class="compact-table">
          <thead><tr><th>Агент</th><th>Задачи в компании</th><th>Контроль прав</th></tr></thead>
          <tbody>
            <tr><td><strong>Аналитик</strong></td><td>Сводки, ОСВ, выгрузки <code>.xlsx/.csv</code>, поиск аномалий</td><td>Чтение и отчёты</td></tr>
            <tr><td><strong>Секретарь</strong></td><td>Поручения со сроками, протоколы совещаний, письма</td><td>Лента и задачи</td></tr>
            <tr><td><strong>Разведчик / Аудитор</strong></td><td>Проверка структуры, прав доступа и журналов безопасности</td><td>Строго read-only</td></tr>
            <tr><td><strong>Конструктор / Разработчик</strong></td><td>Новые справочники, формы, печатные формы, навыки</td><td>В изолированной ветке</td></tr>
            <tr><td><strong>Интегратор / Представитель</strong></td><td>Сверка с внешними БД по OData, связь с филиалами</td><td>Согласование с человеком</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card dark-box">
        <div class="card-head"><div class="card-title">Голосовой и безопасный ИИ</div><span class="tag dark">Full-Duplex Voice</span></div>
        <ul>
          <li><strong>Умный контекст:</strong> кнопка <code>?</code> в любой карточке или ведомости сразу понимает, какой документ или счёт открыт.</li>
          <li><strong>Голос без интернета:</strong> встроенное распознавание <code>Qwen3-ASR 1.7B</code> (ROCm) и быстрый русский синтез <code>Silero TTS v5.6</code> на CPU (отклик &lt;0.3 с).</li>
          <li><strong>Изоляция изменений:</strong> перед применением правок агент запрашивает подтверждение у ответственного сотрудника.</li>
          <li><strong>Самообучение:</strong> удачные сценарии сохраняются как корпоративные навыки и LoRA-адаптеры.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 4, total)}
</section>`,

        // 5. Аппаратный и локальный ИИ стек
        `<section class="slide" data-slide="5" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">4. Приватный ИИ на вашем сервере</div>
      <div class="slide-title">8 оптимизированных локальных моделей + подключение любых внешних API</div>
      <div class="slide-subtitle">Единый стек Windows 11 Native для AMD Ryzen™ AI Max+ PRO 495 (192 ГБ Unified RAM, gfx1151) без тихого падения на медленный CPU</div>
    </div>
    <span class="badge-pill">Halowin Bubo + PyTorch ROCm 7.13</span>
  </div>
  <div class="slide-body">
    <table class="compact-table">
      <thead><tr><th>Модель в /MODELS/Local</th><th>Назначение в компании</th><th>Движок и вычислитель</th><th>Режим памяти</th></tr></thead>
      <tbody>
        <tr><td><strong>Qwen3.8-Flash-Next (180B MoE)</strong></td><td>Флагманский разум: сложная аналитика, агенты, код, отчёты</td><td>Halowin Bubo (ROCm 10 + NPU prefill)</td><td><span class="tag green">Always-Hot</span></td></tr>
        <tr><td><strong>Qwen3-4B / Qwen3-0.6B</strong></td><td>Быстрое сжатие контекста, маршрутизация, классификация</td><td>PyTorch ROCm 7.13 · iGPU gfx1151</td><td><span class="tag green">Always-Hot</span></td></tr>
        <tr><td><strong>Qwen3-ASR 1.7B</strong></td><td>Офлайн-распознавание русской и английской речи</td><td>PyTorch ROCm 7.13 · iGPU gfx1151</td><td><span class="tag green">Always-Hot</span></td></tr>
        <tr><td><strong>Silero TTS v5.6 RU</strong></td><td>Мгновенная русская озвучка (5 дикторов, 48 кГц)</td><td>PyTorch CPU Zen 5 (&lt;0.3 с)</td><td><span class="tag green">Always-Hot</span></td></tr>
        <tr><td><strong>BGE-M3 + BGE-Reranker-v2-M3</strong></td><td>Векторный индекс и точный RAG-поиск по документам/логам</td><td>PyTorch ROCm 7.13 · iGPU gfx1151</td><td><span class="tag green">Always-Hot</span></td></tr>
        <tr><td><strong>Z-Image-Turbo 6B</strong></td><td>Генерация иллюстраций, карточек товаров и презентаций</td><td>PyTorch ROCm 7.13 · iGPU gfx1151</td><td><span class="tag amber">По требованию (10 мин)</span></td></tr>
      </tbody>
    </table>
    <div class="banner green-banner"><strong>Открытая гибридность:</strong> при необходимости подключения сверхтяжёлых моделей (облачные API GigaChat, YandexGPT, T-Bank, MTS AI или собственный GPU-кластер) они подключаются в 1 клик в разделе <code>/MODELS</code>.</div>
  </div>
  ${footerHtml(label, 5, total)}
</section>`,

        // 6. Форматы приобретения
        `<section class="slide" data-slide="6" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">5. Форматы приобретения</div>
      <div class="slide-title">Готовый ПАК «под ключ» или базовая лицензия на ваш сервер</div>
      <div class="slide-subtitle">Перед покупкой можно бесплатно развернуть систему командой <code>npx odant-work</code>, перенести данные и протестировать</div>
    </div>
    <span class="badge-pill green">Бессрочная базовая лицензия</span>
  </div>
  <div class="slide-body">
    <div class="grid-2">
      <div class="card dark-box">
        <div class="card-head">
          <div><span class="tag dark">Рекомендуемый формат</span><div class="card-title" style="font-size:11.5pt;margin-top:1mm;">Готовый ПАК ODANT-WORK</div></div>
          <div class="price-hero">5 000 000 ₽</div>
        </div>
        <ul>
          <li><strong>Оборудование:</strong> AMD Ryzen™ AI Max+ PRO 495 (16C/32T, до 5.2 ГГц), Radeon™ 8065S (61 TFLOPS FP16 + NPU 55 TOPS), 192 ГБ LPDDR5x-8533, SSD 4 ТБ NVMe.</li>
          <li><strong>Лицензии:</strong> 10 вечных конкурентных рабочих мест с криптопривязкой <code>Ed25519</code> + <code>HWID</code>.</li>
          <li><strong>Поддержка:</strong> 1 год уровня <strong>Enterprise 24/7</strong> (реакция до 15 минут) уже в цене.</li>
          <li><strong>Гарантия:</strong> 1 год гарантии на аппаратную платформу.</li>
        </ul>
      </div>
      <div class="card white accent-left">
        <div class="card-head">
          <div><span class="tag">На собственный сервер</span><div class="card-title" style="font-size:11.5pt;margin-top:1mm;">Базовая постоянная лицензия</div></div>
          <div class="price-hero">4 000 000 ₽</div>
        </div>
        <ul>
          <li><strong>Установка за 1 минуту:</strong> <code>npx odant-work</code> на вашей машине (включая самостоятельную сборку на Ryzen AI Max+ 495).</li>
          <li><strong>Полная разблокировка:</strong> снимает стартовый режим 1 сессии BOSS, активирует <strong>10 вечных конкурентных мест</strong> и все 13 ИИ-агентов.</li>
          <li><strong>Поддержка:</strong> 1 год уровня <strong>Enterprise 24/7</strong> включён в стоимость.</li>
          <li><strong>Без привязки к облаку:</strong> продление поддержки и докупка доп. мест со 2-го года — только по желанию.</li>
        </ul>
      </div>
    </div>
    <div class="banner"><strong>Бесплатный режим настройки:</strong> после запуска <code>npx odant-work</code> работает 1 сессия руководителя <code>BOSS</code> бесплатно и без ограничения по времени — для настройки справочников, переноса БД и пилота.</div>
  </div>
  ${footerHtml(label, 6, total)}
</section>`,

        // 7. Тарифы доп. мест и SLA
        `<section class="slide" data-slide="7" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">6. Масштабирование и поддержка (SLA)</div>
      <div class="slide-title">Годовые дополнительные места и скидки за объём до −25%</div>
      <div class="slide-subtitle">Считаются по одновременным активным сессиям (concurrent seats) — в базе можно завести сколько угодно сотрудников</div>
    </div>
    <span class="badge-pill">Автовыпуск через ЮKassa и по счёту</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card white">
        <div class="card-head"><div class="card-title">Start</div><span class="tag">10 000 ₽/год за место</span></div>
        <ul>
          <li><strong>Реакция инженера:</strong> до 8 рабочих часов (Пн–Пт 09–18 МСК)</li>
          <li><strong>Обращения:</strong> до 12 тикетов в год на каждое место</li>
          <li><strong>Каналы:</strong> боты MAX, Telegram, VK</li>
          <li>Обновления ядра и системы учёта</li>
        </ul>
      </div>
      <div class="card accent-left white">
        <div class="card-head"><div class="card-title">Business</div><span class="tag">15 000 ₽/год за место</span></div>
        <ul>
          <li><strong>Реакция инженера:</strong> до 2 часов (ежедневно 08–22 МСК)</li>
          <li><strong>Обращения:</strong> до 48 тикетов в год на каждое место</li>
          <li>Консультации по учёту и процессам</li>
          <li>Администрирование локальных ИИ-моделей</li>
        </ul>
      </div>
      <div class="card dark-box">
        <div class="card-head"><div class="card-title">Enterprise</div><span class="tag dark">20 000 ₽/год за место</span></div>
        <ul>
          <li><strong>Реакция инженера:</strong> до 15 минут (24/7/365)</li>
          <li><strong>Обращения:</strong> безлимитно</li>
          <li>Выделенный инженер сопровождения</li>
          <li>Помощь в дообучении ИИ (LoRA) и навыках</li>
        </ul>
      </div>
    </div>
    <table class="compact-table">
      <thead><tr><th>Пакет доп. мест</th><th>1–4 места</th><th>5–9 мест</th><th>10–24 места</th><th>25–49 мест</th><th>50–99 мест</th><th>100+ мест</th></tr></thead>
      <tbody>
        <tr><td><strong>Объёмная скидка</strong></td><td>0%</td><td><strong>−5%</strong></td><td><strong>−10%</strong></td><td><strong>−15%</strong></td><td><strong>−20%</strong></td><td><strong>−25%</strong></td></tr>
        <tr><td><strong>Business (за 1 место/год)</strong></td><td>15 000 ₽</td><td>14 250 ₽</td><td>13 500 ₽</td><td>12 750 ₽</td><td>12 000 ₽</td><td>11 250 ₽</td></tr>
      </tbody>
    </table>
  </div>
  ${footerHtml(label, 7, total)}
</section>`,

        // 8. Внедрение и автоматическая активация
        `<section class="slide" data-slide="8" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">7. Запуск и миграция без простоев</div>
      <div class="slide-title">От оплаты в ЮKassa до работающих лицензий — 30 секунд автоматически</div>
      <div class="slide-subtitle">Полная автоматизация выпуска сертификатов <code>Ed25519</code>, привязки сервера и переноса исторических учётных баз</div>
    </div>
    <span class="badge-pill green">Мгновенная автоактивация</span>
  </div>
  <div class="slide-body">
    <div class="flow-row">
      <div class="flow-step"><div class="step-num">Шаг 1 · Установка</div><div class="step-title">Запуск на сервере</div><p>Развёртывание через <code>npx odant-work</code> или включение готового ПАК в сети компании.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 2 · Привязка</div><div class="step-title">Токен владельца owk1</div><p>Регистрация на <code>work.odant.org</code> и вставка токена сервера в панель лицензий WORK.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 3 · Оплата</div><div class="step-title">ЮKassa или Счёт-договор</div><p>Оплата в Личном кабинете (чек 54-ФЗ) либо безналичный перевод по счёту юрлица.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 4 · Старт</div><div class="step-title">Автовключение за 30 с</div><p>Сервер WORK сам забирает <code>.lic.json</code> и активирует 10+ мест и 13 ИИ-агентов без перезапуска.</p></div>
    </div>
    <div class="grid-2">
      <div class="card white accent-left">
        <div class="card-title">Миграция и дополнительные пакеты</div>
        <ul>
          <li><strong>Перенос исторических баз и остатков (450 000 ₽):</strong> импорт справочников, контрагентов, планов счетов и проводок из прежних учётных систем и таблиц.</li>
          <li><strong>Дообучение ИИ и навыки (600 000 ₽):</strong> LoRA-адаптация под отраслевую терминологию и регламенты компании.</li>
          <li><strong>Комплект NAS-резервирования (350 000 ₽):</strong> автоматическое архивирование баз организаций.</li>
        </ul>
      </div>
      <div class="card white green-left">
        <div class="card-title">Надёжность и юридическая чистота</div>
        <ul>
          <li><strong>Отечественный правообладатель:</strong> ООО «БИС» (аккредитованная ИТ-компания, Реестр ПО Минцифры РФ № 3505 от 03.05.2017; внедрения группы с <code>infostandart.com</code> вкл. ПАО «Россети»).</li>
          <li><strong>Криптоподпись Ed25519:</strong> автономная работа без постоянного интернета по локальным <code>.lic.json</code>.</li>
          <li><strong>Поддержка в мессенджерах:</strong> тикеты, статус лицензий и докупка мест прямо из MAX, Telegram и VK.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 8, total)}
</section>`,

        // 9. Контакты и призыв к действию
        `<section class="slide dark" data-slide="9" data-section="clients">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">8. Начать работу с ODANT-WORK</div>
      <div class="slide-title">Запустите цифровой контур вашей компании уже сегодня</div>
      <div class="slide-subtitle">Самостоятельный бесплатный тест, заказ готового ПАК или консультация архитектора ООО «БИС»</div>
    </div>
    <span class="badge-pill dark-pill">work.odant.org</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card dark-box">
        <div class="card-title">1. Бесплатный пилот за 1 минуту</div>
        <p>Установите систему на ваш ПК или сервер: <code>npx odant-work</code>. Настройте учёт и посмотрите интерфейсы в бесплатном режиме <code>BOSS</code>.</p>
      </div>
      <div class="card dark-box">
        <div class="card-title">2. Расчёт и заказ на витрине</div>
        <p>Откройте калькулятор на <code>work.odant.org/#clients</code>, подберите ПАК или базовую лицензию + доп. места и оплатите через ЮKassa или по счёту.</p>
      </div>
      <div class="card dark-box">
        <div class="card-title">3. Живая демонстрация</div>
        <p>Покажем работу учёта, встроенного офиса, голосового диалога и 13 ИИ-агентов на ваших реальных документах и проводках.</p>
      </div>
    </div>
    <div class="banner" style="background:rgba(255,255,255,0.08);border-color:rgba(125,211,252,0.4);color:#e0f2fe;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4mm;">
      <div>
        <strong style="color:#ffffff;">Правообладатель и разработчик:</strong> ООО «БИС» (ИНН 6234049193, ОГРН 1076234013712) · 390000, г. Рязань, ул. Ленина, 47
      </div>
      <div>
        <strong style="color:#ffffff;">Тел.:</strong> +7 (4912) 77-70-21, 77-70-22 · <strong style="color:#ffffff;">Портал:</strong> <span style="color:#38bdf8;font-weight:700;">https://work.odant.org</span> · <span style="color:#38bdf8;font-weight:700;">https://www.odant.ru</span>
      </div>
    </div>
  </div>
  ${footerHtml(label, 9, total)}
</section>`,
    ].join('\n');

    return wrapDeck({
        title: 'ODANT-WORK — презентация для клиентов (ООО «БИС»)',
        deckLabel: label,
        slidesHtml: slides,
    });
}

/* ============================================================================
 * 2. ПРЕЗЕНТАЦИЯ ДЛЯ ФРАНЧАЙЗЕРОВ (9 слайдов)
 * ============================================================================ */
function buildFranchisePresentation() {
    const label = 'Презентация для франчайзеров';
    const total = 9;
    const slides = [
        // 1. Обложка
        `<section class="slide dark" data-slide="1" data-section="franchise">
  <div class="cover-main">
    <div>
      <div class="cover-brand">
        <img class="cover-logo" src="${logoDataUri}" alt="ODANT">
        <div>
          <div class="cover-brand-name">ODANT<span style="color:#38bdf8;">·</span>WORK</div>
          <div class="cover-brand-sub">Региональная франшиза в 89 субъектах РФ · ООО «БИС»</div>
        </div>
      </div>
      <h1 class="cover-h1">Зарабатывайте на поставке ПАК, лицензий и <span>приватного ИИ</span> в вашем регионе</h1>
      <p class="cover-lead">
        Официальное партнёрство от правообладателя ООО «БИС» (Реестр ПО № 3505): защищённая квота субъекта РФ,
        прогрессивная скидка <strong>10% → 50%</strong> на лицензии и комплексы + <strong>100% дохода</strong> от внедрения, железа и собственного ИИ-сервиса.
      </p>
      <div class="cover-badges">
        <span class="cover-badge">1 компания = 1 франшиза в регионе</span>
        <span class="cover-badge">Невозвратный залог 100 000 ₽</span>
        <span class="cover-badge">Мгновенная активация через ЮKassa</span>
        <span class="cover-badge">12 мес. на погашение остатка</span>
      </div>
    </div>
    <div class="cover-right-panel">
      <div style="font-size:9.5pt;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.08em;">Экономика франшизы в цифрах</div>
      <div class="cover-stat-grid">
        <div class="cover-stat"><div class="val">100 000 ₽</div><div class="lbl">Невозвратный залог при бронировании региона (автоактивация за 1 мин)</div></div>
        <div class="cover-stat"><div class="val">10% → 50%</div><div class="lbl">Скидка партнёра на ПАК (5 млн ₽) и лицензии (4 млн ₽ + годовые)</div></div>
        <div class="cover-stat"><div class="val">100%</div><div class="lbl">Доход партнёра с NAS, ИИ-кластеров, API, SLA и LoRA-проектов</div></div>
        <div class="cover-stat"><div class="val">2,8–4,5 млн</div><div class="lbl">Потенциал чистой прибыли партнёра с 1 среднего корпоративного клиента</div></div>
      </div>
      <div style="background:rgba(245,158,11,0.14);border-left:3px solid #f59e0b;padding:2.5mm 3.2mm;border-radius:1.6mm;font-size:8.4pt;color:#fef3c7;line-height:1.36;">
        <strong>Важное условие входа:</strong> залог 100 000 ₽ является <strong>невозвратным</strong> — он сразу закрепляет за вами региональную квоту, активирует статус партнёра и засчитывается в счёт паушального взноса.
      </div>
    </div>
  </div>
  ${footerHtml(label, 1, total)}
</section>`,

        // 2. Суть продукта (что продаёт партнёр)
        `<section class="slide" data-slide="2" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">1. Продукт с высоким спросом</div>
      <div class="slide-title">Что именно вы продаёте и внедряете предприятиям региона</div>
      <div class="slide-subtitle">Готовый импортозамещающий комплекс ODANT-WORK на базе отечественной СУБД (Реестр ПО Минцифры РФ № 3505)</div>
    </div>
    <span class="badge-pill">Средний чек от 4–5 млн ₽</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card white accent-left">
        <div class="card-title">1. Учёт и документооборот</div>
        <p>План счетов, двойная запись, сторно, отчётность, встроенные редакторы таблиц, документов и презентаций, задачи и права доступа.</p>
      </div>
      <div class="card white accent-left">
        <div class="card-title">2. Приватный ИИ на борту</div>
        <p>13 ролевых ИИ-агентов, кнопка «?» в каждой форме, голосовой диалог (ASR/TTS), RAG-поиск и генерация изображений внутри контура клиента.</p>
      </div>
      <div class="card white accent-left">
        <div class="card-title">3. Два формата для клиента</div>
        <p><strong>ПАК 5 млн ₽</strong> (сервер Ryzen AI Max+ 495 · 192 ГБ + 10 вечных мест) или <strong>базовая лицензия 4 млн ₽</strong> на сервер клиента + годовые места.</p>
      </div>
    </div>
    <div class="banner"><strong>Почему клиенты покупают у регионального партнёра:</strong> компаниям в регионах критически важны локальный выезд, сборка/поставка железа, перенос исторических баз и таблиц, настройка учётной политики и живая 1-я линия поддержки на месте.</div>
  </div>
  ${footerHtml(label, 2, total)}
</section>`,

        // 3. Защита территории и невозвратный залог
        `<section class="slide" data-slide="3" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">2. Защита территории и условия входа</div>
      <div class="slide-title">Квота по населению и невозвратный залог 100 000 ₽ с автоактивацией</div>
      <div class="slide-subtitle">Интерактивная карта 89 субъектов РФ на <code>work.odant.org/#franchise</code> в реальном времени защищает ваш рынок от демпинга</div>
    </div>
    <span class="badge-pill amber">Залог невозвратный · 15 мин на оплату</span>
  </div>
  <div class="slide-body">
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-num">1 / 1 млн</div><div class="kpi-label">Жёсткая квота в регионе</div><div class="kpi-sub">1 партнёр на 1 млн населения субъекта (минимум 1)</div></div>
      <div class="kpi-box"><div class="kpi-num">500 000 ₽ × k</div><div class="kpi-label">Паушальный взнос</div><div class="kpi-sub">Пропорционально экономическому индексу региона (k = 0.5…2.0)</div></div>
      <div class="kpi-box"><div class="kpi-num">100 000 ₽</div><div class="kpi-label">Невозвратный залог</div><div class="kpi-sub">Оплата через ЮKassa за 15 мин · засчитывается в паушал</div></div>
      <div class="kpi-box"><div class="kpi-num">12 месяцев</div><div class="kpi-label">Рассрочка без %</div><div class="kpi-sub">Равномерный помесячный график на остаток суммы</div></div>
    </div>
    <div class="grid-2">
      <div class="card white green-left">
        <div class="card-title">Правила честной конкуренции в регионе</div>
        <ul>
          <li><strong>Одна компания — одна франшиза в регионе:</strong> один игрок не может скупить всю квоту субъекта, но может открывать филиалы в разных регионах.</li>
          <li><strong>Мгновенная активация по ЮKassa:</strong> сразу после оплаты невозвратного залога 100 000 ₽ система автоматически создаёт партнёрский аккаунт (<code>PRT-...</code>) со скидкой 10%.</li>
          <li><strong>Прозрачный график в ЛК:</strong> оставшаяся часть взноса видна по месяцам (с кнопкой досрочного погашения).</li>
        </ul>
      </div>
      <div class="card white amber-left">
        <div class="card-title">Условие невозвратности залога</div>
        <ul>
          <li>При оформлении брони слот региона замораживается на <strong>15 минут</strong> для оплаты залога через ЮKassa.</li>
          <li>Уплаченный залог <strong>100 000 ₽ является невозвратным</strong>: он подтверждает серьёзность намерений партнёра и компенсирует блокировку квоты.</li>
          <li>При отказе партнёра от франшизы или систематической просрочке графика квота субъекта возвращается в свободный пул без возврата залога.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 3, total)}
</section>`,

        // 4. Операционная модель партнёра
        `<section class="slide" data-slide="4" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">3. Операционная модель</div>
      <div class="slide-title">Что делает региональный партнёр, а что даёт ООО «БИС»</div>
      <div class="slide-subtitle">Чёткое разделение ответственности: вендор развивает платформу и центр лицензий, партнёр ведёт проекты в регионе</div>
    </div>
    <span class="badge-pill">Полная автономия сборки и поставок</span>
  </div>
  <div class="slide-body">
    <div class="grid-2">
      <div class="card white accent-left">
        <div class="card-head"><div class="card-title">Зона работы и заработка партнёра</div><span class="tag">На стороне региона</span></div>
        <ul>
          <li><strong>Закупка и сборка ПАК:</strong> самостоятельная закупка платформ AMD Ryzen™ AI Max+ PRO 495 (192 ГБ, SSD 4 ТБ) у дистрибьюторов и сборка под клиента.</li>
          <li><strong>Развёртывание и настройка:</strong> установка ODANT-WORK, учётной конфигурации, офисных шаблонов и 8 локальных ИИ-моделей.</li>
          <li><strong>Выпуск лицензий в ЛК:</strong> привязка <code>HWID</code> оборудования + <code>node-key.json</code> и выпуск подписанных лицензий клиентам со своей скидкой.</li>
          <li><strong>Гарантия и 1-я линия:</strong> предоставление 1 года гарантии на железо и локальное сопровождение клиентов.</li>
        </ul>
      </div>
      <div class="card white green-left">
        <div class="card-head"><div class="card-title">Обеспечение от ООО «БИС»</div><span class="tag green">От вендора</span></div>
        <ul>
          <li><strong>Готовая платформа и обновления:</strong> ядро WORK, учёт <code>/MODULES/Register</code>, встроенный офис, 13 ИИ-агентов и локальный тренер моделей.</li>
          <li><strong>Криптографический центр <code>Ed25519</code>:</strong> автоматизированный личный кабинет партнёра на <code>work.odant.org</code> для выпуска и учёта лицензий.</li>
          <li><strong>Обучение и сертификация:</strong> 4 профильных курса подготовки инженеров, архитекторов учёта, разработчиков и менеджеров продаж.</li>
          <li><strong>Эскалация 2–3 линии и лиды:</strong> поддержка сложных внедрений и передача входящих региональных запросов партнёрам субъекта.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 4, total)}
</section>`,

        // 5. 6 потоков дохода и скидка 10 -> 50%
        `<section class="slide" data-slide="5" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">4. Финансовая модель партнёра</div>
      <div class="slide-title">Прогрессивная скидка 10% → 50% и 6 потоков высокомаржинальной выручки</div>
      <div class="slide-subtitle">Скидка растёт автоматически с вашим годовым объёмом продаж, а доп. услуги и доп. оборудование приносят 100% дохода партнёру</div>
    </div>
    <span class="badge-pill green">Высокая маржа с каждой сделки</span>
  </div>
  <div class="slide-body">
    <table class="compact-table">
      <thead><tr><th>Поток выручки партнёра</th><th>Доля партнёра</th><th>Средний чек / ориентир</th><th>Характер дохода</th></tr></thead>
      <tbody>
        <tr><td><strong>1. Продажа комплексов ПАК и лицензий ODANT-WORK</strong></td><td>Скидка <strong>10% → 50%</strong> + аппаратная маржа</td><td>500 000 – 2 500 000 ₽ с 1 сделки</td><td>Разовая + допродажи мест</td></tr>
        <tr><td><strong>2. Поставка NAS-систем резервного копирования</strong></td><td><strong>100% доход партнёра</strong></td><td>~350 000 ₽ на клиента</td><td>Разовая + ТО</td></tr>
        <tr><td><strong>3. Оборудование для инференса и ИИ-кластеров</strong></td><td><strong>100% доход партнёра</strong></td><td>~1 200 000 ₽ на проект</td><td>Проектная поставка</td></tr>
        <tr><td><strong>4. Собственный платный API партнёра к моделям ИИ</strong></td><td><strong>100% ARR доход партнёра</strong></td><td>~360 000 ₽/год с клиента</td><td>Регулярная подписка</td></tr>
        <tr><td><strong>5. Техподдержка (1–2 линия SLA) и сервис</strong></td><td><strong>100% доход по договорам партнёра</strong></td><td>~240 000 ₽/год с клиента</td><td>Регулярная подписка</td></tr>
        <tr><td><strong>6. Дообучение ИИ-агентов (LoRA), навыки и миграция</strong></td><td><strong>100% проектный доход партнёра</strong></td><td>600 000 – 1 050 000 ₽</td><td>Внедрение и консалтинг</td></tr>
      </tbody>
    </table>
    <div class="banner"><strong>Шкала роста скидки (статусы партнёра):</strong> старт после залога — <strong>10% (Start)</strong> · 25 млн ₽/год — <strong>20% (Silver)</strong> · 50 млн ₽/год — <strong>30% (Gold)</strong> · 75 млн ₽/год — <strong>40% (Platinum)</strong> · 100 млн ₽/год — <strong>50% (Master)</strong>.</div>
  </div>
  ${footerHtml(label, 5, total)}
</section>`,

        // 6. Калькулятор экономики на примере региона
        `<section class="slide" data-slide="6" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">5. Расчёт окупаемости</div>
      <div class="slide-title">Юнит-экономика партнёра: типовой регион vs миллионник</div>
      <div class="slide-subtitle">Окупаемость паушального взноса наступает уже с 1-й продажи лицензии / ПАК предприятию региона</div>
    </div>
    <span class="badge-pill green">Окупаемость с 1-й сделки</span>
  </div>
  <div class="slide-body">
    <div class="grid-2">
      <div class="card white accent-left">
        <div class="card-head"><div class="card-title">Пример А: Область (индекс 0.8, напр. Рязанская)</div><span class="tag">Взнос 400 000 ₽</span></div>
        <ul>
          <li><strong>Вход:</strong> 100 000 ₽ невозвратный залог + 25 000 ₽/мес × 12 мес. (300 000 ₽ остаток).</li>
          <li><strong>1-я сделка (базовая лицензия 4 млн + 15 мест + внедрение):</strong></li>
          <li>• Маржа на лицензиях (20% при объёме / старт 10%): <strong>420–850 тыс. ₽</strong></li>
          <li>• Миграция и дообучение ИИ (100% партнёру): <strong>+600 тыс. ₽</strong></li>
          <li>• NAS + настройка + годовой SLA (100% партнёру): <strong>+590 тыс. ₽</strong></li>
          <li><strong>Итого доход с 1 клиента: ~1,6 – 2,0 млн ₽</strong> (окупаемость взноса 4–5× на первом клиенте).</li>
        </ul>
      </div>
      <div class="card dark-box">
        <div class="card-head"><div class="card-title">Пример Б: Миллионник / Москва (индекс 1.2 – 2.0)</div><span class="tag dark">Взнос 600 тыс. – 1 млн ₽</span></div>
        <ul>
          <li><strong>Цель года (5 корпоративных клиентов / ~25 млн ₽ оборота):</strong></li>
          <li>• Выход на скидку <strong>20–30%</strong> (статус Silver / Gold).</li>
          <li>• Валовая маржа с ПАК и доп. мест: <strong>~5,0 – 7,5 млн ₽</strong></li>
          <li>• Доп. оборудование (NAS, ИИ-узлы) и LoRA-проекты: <strong>~6,0 – 8,5 млн ₽</strong></li>
          <li>• Регулярная база подписки (API + SLA 2-го года): <strong>~3,0 млн ₽/год ARR</strong></li>
          <li><strong>Итого за год: 14–19 млн ₽ валового дохода партнёра</strong> на растущем портфеле.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 6, total)}
</section>`,

        // 7. Программа обучения и сертификации
        `<section class="slide" data-slide="7" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">6. Подготовка команды партнёра</div>
      <div class="slide-title">4 программы сертификации специалистов партнёра от ООО «БИС»</div>
      <div class="slide-subtitle">Обеспечивают единое качество внедрений и позволяют команде партнёра закрывать проекты «под ключ» своими силами</div>
    </div>
    <span class="badge-pill">Обязательный минимум — 3 трека</span>
  </div>
  <div class="slide-body">
    <div class="grid-4">
      <div class="card white accent-left">
        <span class="tag">WORK-CERT-ENG · 40 ч</span>
        <div class="card-title">Инженер ПАК и локального ИИ</div>
        <p>Ryzen AI Max+ 495 (192 ГБ), настройка BIOS UMA/NPU, ROCm 7.13 / Bubo, LoRA, привязка HWID и <code>node-key.json</code>.</p>
      </div>
      <div class="card white accent-left">
        <span class="tag">WORK-CERT-ACC · 48 ч</span>
        <div class="card-title">Архитектор учёта и процессов</div>
        <p><code>/MODULES/Register</code>, двойная запись, сторно, ОСВ, анализ счёта, документооборот и миграция исторических БД и таблиц.</p>
      </div>
      <div class="card white">
        <span class="tag green">WORK-CERT-DEV · 36 ч</span>
        <div class="card-title">Разработчик модулей и навыков</div>
        <p>Наследование метаданных, формы ODA, серверные методы, навыки ИИ-консультанта и федерация <code>NODES</code>.</p>
      </div>
      <div class="card white accent-left">
        <span class="tag">WORK-CERT-SLS · 24 ч</span>
        <div class="card-title">Эксперт по продажам и SLA</div>
        <p>Расчёт ROI для клиента, лицензирование конкурентных сессий, работа с офертой и поддержка в MAX / Telegram / VK.</p>
      </div>
    </div>
    <div class="banner green-banner"><strong>Экзамен и реестр сертификатов:</strong> каждый аттестованный сотрудник получает именной цифровой сертификат в реестре <code>work.odant.org</code> (<code>/api/partners/certify</code>) с отображением статуса сертифицированного партнёра на карте регионов.</div>
  </div>
  ${footerHtml(label, 7, total)}
</section>`,

        // 8. Автоматизация в Личном кабинете партнёра
        `<section class="slide" data-slide="8" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">7. Цифровой контур партнёра</div>
      <div class="slide-title">Полностью автоматизированный путь от выбора региона до выпуска лицензий</div>
      <div class="slide-subtitle">Все операции проходят в едином Личном кабинете на <code>work.odant.org</code> с мгновенной оплатой через ЮKassa</div>
    </div>
    <span class="badge-pill green">Без бумажной волокиты</span>
  </div>
  <div class="slide-body">
    <div class="flow-row">
      <div class="flow-step"><div class="step-num">Шаг 1</div><div class="step-title">Выбор региона РФ</div><p>Клик по субъекту на карте <code>work.odant.org/#franchise</code>, просмотр свободной квоты и взноса.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 2</div><div class="step-title">Регистрация + Оферта ПЭП</div><p>Вход по 6-значному коду на Email, заполнение ИНН/реквизитов и подписание публичной оферты.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 3</div><div class="step-title">Залог 100 000 ₽ (15 мин)</div><p>Оплата <strong>невозвратного залога</strong> через ЮKassa (чек 54-ФЗ) — слот закрепляется, партнёр активирован!</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">Шаг 4</div><div class="step-title">Работа и график 12 мес.</div><p>Выпуск лицензий клиентам со скидкой 10%→50% и помесячное погашение остатка в ЛК.</p></div>
    </div>
    <div class="banner amber-banner"><strong>Напоминание по регламенту:</strong> резерв без оплаты залога автоматически сгорает через 15 минут; при досрочном погашении остатка паушального взноса через ЮKassa или по счёту статус франшизы переходит в <code>Выкуплена полностью (12/12)</code>.</div>
  </div>
  ${footerHtml(label, 8, total)}
</section>`,

        // 9. Финал
        `<section class="slide dark" data-slide="9" data-section="franchise">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">8. Закрепите регион за своей компанией</div>
      <div class="slide-title">Станьте официальным региональным партнёром ODANT-WORK</div>
      <div class="slide-subtitle">Число франшиз в каждом субъекте строго ограничено численностью населения</div>
    </div>
    <span class="badge-pill dark-pill">work.odant.org/#franchise</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card dark-box"><div class="card-title">1. Проверьте квоту своего региона</div><p>Откройте интерактивную карту РФ на <code>work.odant.org/#franchise</code> и посмотрите число свободных мест и индекс вашего субъекта.</p></div>
      <div class="card dark-box"><div class="card-title">2. Оплатите невозвратный залог</div><p>Внесите 100 000 ₽ через ЮKassa — квота закрепится мгновенно, откроется кабинет партнёра и стартовая скидка 10%.</p></div>
      <div class="card dark-box"><div class="card-title">3. Запустите первые внедрения</div><p>Пройдите экспресс-онбординг инженеров с командой ООО «БИС» и начните поставки ПАК и лицензий в своём регионе.</p></div>
    </div>
    <div class="banner" style="background:rgba(255,255,255,0.08);border-color:rgba(125,211,252,0.4);color:#e0f2fe;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4mm;">
      <div><strong style="color:#ffffff;">Правообладатель:</strong> ООО «БИС» (ИНН 6234049193, ОГРН 1076234013712) · 390000, г. Рязань, ул. Ленина, 47</div>
      <div><strong style="color:#ffffff;">Тел.:</strong> +7 (4912) 77-70-21, 77-70-22 · <strong style="color:#ffffff;">Карта франшиз:</strong> <span style="color:#38bdf8;font-weight:700;">https://work.odant.org/#franchise</span></div>
    </div>
  </div>
  ${footerHtml(label, 9, total)}
</section>`,
    ].join('\n');

    return wrapDeck({
        title: 'ODANT-WORK — презентация для франчайзеров (ООО «БИС»)',
        deckLabel: label,
        slidesHtml: slides,
    });
}

/* ============================================================================
 * 3. ПРЕЗЕНТАЦИЯ ДЛЯ ИНВЕСТОРОВ (9 слайдов)
 * ============================================================================ */
function buildInvestorsPresentation() {
    const label = 'Презентация для инвесторов';
    const total = 9;
    const slides = [
        // 1. Обложка
        `<section class="slide dark" data-slide="1" data-section="investors">
  <div class="cover-main">
    <div>
      <div class="cover-brand">
        <img class="cover-logo" src="${logoDataUri}" alt="ODANT">
        <div>
          <div class="cover-brand-name">ODANT<span style="color:#38bdf8;">·</span>WORK</div>
          <div class="cover-brand-sub">Инвестиционный обзор · ООО «БИС»</div>
        </div>
      </div>
      <h1 class="cover-h1">Масштабируемая платформа корпоративного учёта и <span>приватного ИИ</span></h1>
      <p class="cover-lead">
        <strong>ООО «БИС»</strong> (аккредитованная ИТ-компания с 2007 года, правообладатель СУБД ODANT — Реестр ПО № 3505)
        коммерциализирует флагманский продукт <strong>ODANT-WORK</strong> через прямые продажи ПАК/лицензий и региональную франшизу в 89 субъектах РФ.
      </p>
      <div class="cover-badges">
        <span class="cover-badge">ООО «БИС» · с 2007 года</span>
        <span class="cover-badge">Реестр Минцифры РФ № 3505</span>
        <span class="cover-badge">Автоматический биллинг ЮKassa</span>
        <span class="cover-badge">89 субъектов РФ (квота по населению)</span>
      </div>
    </div>
    <div class="cover-right-panel">
      <div style="font-size:9.5pt;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.08em;">Инвестиционные метрики модели</div>
      <div class="cover-stat-grid">
        <div class="cover-stat"><div class="val">4–5 млн ₽</div><div class="lbl">Средний чек первичной продажи (базовая лицензия / ПАК)</div></div>
        <div class="cover-stat"><div class="val">~146 ед.</div><div class="lbl">Ёмкость квоты франшиз в 89 регионах РФ (1 на 1 млн чел.)</div></div>
        <div class="cover-stat"><div class="val">100 000 ₽</div><div class="lbl">Невозвратный залог бронирования региона (с автоактивацией)</div></div>
        <div class="cover-stat"><div class="val">3 потока</div><div class="lbl">Выручка: базовые лицензии + ARR подписка мест/SLA + франшиза</div></div>
      </div>
      <div style="background:rgba(56,189,248,0.12);border-left:3px solid #38bdf8;padding:2.5mm 3.2mm;border-radius:1.6mm;font-size:8.4pt;color:#e0f2fe;line-height:1.36;">
        <strong>Инвестиционное предложение:</strong> вход в капитал / стратегическое партнёрство по коммерциализации сети ODANT-WORK — <strong>условия по запросу на переговорах</strong> с директором ООО «БИС».
      </div>
    </div>
  </div>
  ${footerHtml(label, 1, total)}
</section>`,

        // 2. Профиль и технологический задел ООО «БИС»
        `<section class="slide" data-slide="2" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">1. Эмитент и технологический актив</div>
      <div class="slide-title">ООО «БИС» — 19 лет разработки промышленной платформы ODANT</div>
      <div class="slide-subtitle">Не стартап «на слайдах», а зрелая технология, проверенная крупными отраслевыми внедрениями</div>
    </div>
    <span class="badge-pill green">Аккредитованная ИТ-компания</span>
  </div>
  <div class="slide-body">
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-num">2007 г.</div><div class="kpi-label">Регистрация ООО «БИС»</div><div class="kpi-sub">ИНН 6234049193 · ОГРН 1076234013712</div></div>
      <div class="kpi-box"><div class="kpi-num">№ 3505</div><div class="kpi-label">Реестр отечественного ПО</div><div class="kpi-sub">СУБД Платформа Odant (от 03.05.2017)</div></div>
      <div class="kpi-box"><div class="kpi-num">РГРТУ</div><div class="kpi-label">Инженерное ядро</div><div class="kpi-sub">Сильная школа системной и ИИ-разработки</div></div>
      <div class="kpi-box"><div class="kpi-num">Enterprise</div><div class="kpi-label">Промышленные внедрения</div><div class="kpi-sub">Опыт в энергетике (ПАО «Россети»), ЖКХ, импортозамещении SAP</div></div>
    </div>
    <div class="grid-2">
      <div class="card white accent-left">
        <div class="card-title">Почему барьер входа конкурентов очень высок</div>
        <ul>
          <li><strong>Собственная объектно-файловая СУБД + веб-фреймворк ODA:</strong> папка одновременно является объектом данных, API и интерфейсом — разработка новых модулей в разы быстрее классических стеков.</li>
          <li><strong>Регуляторная готовность:</strong> запись в Реестре Минцифры № 3505 снимает барьер 44-ФЗ / 223-ФЗ и импортозамещения у госсектора и крупного бизнеса.</li>
        </ul>
      </div>
      <div class="card white green-left">
        <div class="card-title">Ключевой сдвиг 2026 года</div>
        <ul>
          <li><strong>Упаковка в коробочный ПАК и npm-дистрибутив:</strong> вместо долгих заказных проектов ODANT стал тиражируемым продуктом <code>ODANT-WORK</code> (развёртывание за 1 минуту).</li>
          <li><strong>Готовая цифровая витрина биллинга:</strong> центр сертификации <code>Ed25519</code>, ЮKassa, ЛК клиента/франчайзи и боты MAX/Telegram уже работают в продакшене.</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 2, total)}
</section>`,

        // 3. Рыночное окно и проблема
        `<section class="slide" data-slide="3" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">2. Рыночная возможность</div>
      <div class="slide-title">Три мегатренда сходятся в одной точке спроса</div>
      <div class="slide-subtitle">Российскому среднему и крупному бизнесу нужна замена западных систем с локальным ИИ без утечки данных</div>
    </div>
    <span class="badge-pill">Импортозамещение + Приватный ИИ</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card white accent-left">
        <div class="card-head"><div class="card-title">1. Уход западного ПО</div><span class="tag">SAP / MS 365</span></div>
        <p>Компании ищут единый российский контур вместо связки SAP/SharePoint/Teams/Slack, но получают разрозненные решения с дорогой интеграцией.</p>
      </div>
      <div class="card white accent-left">
        <div class="card-head"><div class="card-title">2. Страх облачных LLM</div><span class="tag">152-ФЗ / NDA</span></div>
        <p>Директора и СБ запрещают загружать бухгалтерию и договоры во внешние SaaS-боты, но хотят ИИ-аналитика и автоматизацию рутины на своём сервере.</p>
      </div>
      <div class="card white accent-left">
        <div class="card-head"><div class="card-title">3. Эра 192 ГБ Unified RAM</div><span class="tag">Ryzen AI Max+ 495</span></div>
        <p>Появление компактных рабочих станций с 192 ГБ общей памяти позволило запускать 180B MoE + голос + RAG + графику локально за 1 млн ₽ железа вместо серверной за 15 млн ₽.</p>
      </div>
    </div>
    <div class="banner"><strong>Уникальное позиционирование ODANT-WORK:</strong> единый продукт объединяет бухгалтерский/управленческий учёт, встроенный офис без Docker, процессы и 8 локальных моделей ИИ с 13 агентами в собственном контуре клиента.</div>
  </div>
  ${footerHtml(label, 3, total)}
</section>`,

        // 4. Продукт и технологический ров
        `<section class="slide" data-slide="4" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">3. Продукт и защищённость (Moat)</div>
      <div class="slide-title">Почему клиенты не уходят: глубокое владение данными и процессами</div>
      <div class="slide-subtitle">ODANT-WORK становится операционной системой компании с высоким LTV и нулевым оттоком базовой инсталляции</div>
    </div>
    <span class="badge-pill">Высокий LTV · Низкий Churn</span>
  </div>
  <div class="slide-body">
    <div class="grid-2">
      <div class="card white">
        <div class="card-title">Архитектурные преимущества (Сделано в ООО «БИС»)</div>
        <ul>
          <li><strong>Трёхосевое наследование метаданных:</strong> кастомизация под отрасль без переписывания ядра и без поломки обновлений из npm.</li>
          <li><strong>Изолированные БД организаций:</strong> каждая компания хранит учёт (<code>work.db</code>) и документы в своём защищённом каталоге.</li>
          <li><strong>Мультиагентный движок с правами:</strong> 13 субагентов (включая strictly read-only Аудитора) и 26+ навыков.</li>
          <li><strong>Синхронизация и защита от пиратства:</strong> криптосертификаты <code>Ed25519</code> + аппаратная привязка к <code>HWID</code> и ключу узла.</li>
        </ul>
      </div>
      <div class="card dark-box">
        <div class="card-title">Законченный биллинг и автоматизация</div>
        <ul>
          <li><strong>Витрина <code>work.odant.org</code>:</strong> калькулятор лицензий, карта 89 регионов РФ, ЛК с реестром N серверов и офертой ПЭП.</li>
          <li><strong>Полная автоматика ЮKassa (54-ФЗ):</strong> оплата мгновенно активирует лицензию или региональную франшизу с двойной сверкой статуса платежа.</li>
          <li><strong>Оперативный контроль:</strong> админ-панель <code>/admin</code> интегрирована с ботами <strong>MAX</strong> и <strong>Telegram</strong> (уведомления о регистрациях, заявках, оплатах и активациях).</li>
        </ul>
      </div>
    </div>
  </div>
  ${footerHtml(label, 4, total)}
</section>`,

        // 5. Тройная модель монетизации
        `<section class="slide" data-slide="5" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">4. Бизнес-модель и монетизация</div>
      <div class="slide-title">Три взаимодополняющих потока выручки для ООО «БИС»</div>
      <div class="slide-subtitle">Базовый кэшфлоу от крупных чеков + прогнозируемый рекуррентный ARR + масштабирование чужими руками через франшизу</div>
    </div>
    <span class="badge-pill green">Высокая маржинальность ПО</span>
  </div>
  <div class="slide-body">
    <table class="compact-table">
      <thead><tr><th>Канал монетизации</th><th>Продукт и прайс</th><th>Экономика для ООО «БИС»</th></tr></thead>
      <tbody>
        <tr><td><strong>1. Базовые продажи (High-Ticket)</strong></td><td>ПАК ODANT-WORK (<strong>5 000 000 ₽</strong>) или базовая вечная лицензия на 10 мест (<strong>4 000 000 ₽</strong>)</td><td>Высокая маржа ПО (~95% на лицензии; аппаратная часть собирается под заказ или силами франчайзи)</td></tr>
        <tr><td><strong>2. Рекуррентные подписки (ARR)</strong></td><td>Дополнительные конкурентные места со 2-го года: <strong>10 000 / 15 000 / 20 000 ₽/год</strong> (Start / Business / Enterprise)</td><td>Стабильный годовой поток продлений от растущей базы активных серверов</td></tr>
        <tr><td><strong>3. Региональная франшиза (89 субъектов РФ)</strong></td><td>Паушальный взнос <strong>300 тыс. – 1 млн ₽</strong> (невозвратный залог <strong>100 000 ₽</strong> + 12 мес.) и отчисления с продаж партнёров (скидка 10%→50%)</td><td>Масштабирование по всей стране без раздувания собственного штата продаж и внедрения</td></tr>
      </tbody>
    </table>
    <div class="kpi-row">
      <div class="kpi-box"><div class="kpi-num">50–90%</div><div class="kpi-label">Доля ООО «БИС»</div><div class="kpi-sub">В лицензионных продажах через партнёрскую сеть</div></div>
      <div class="kpi-box"><div class="kpi-num">100 тыс. ₽</div><div class="kpi-label">Невозвратный залог</div><div class="kpi-sub">Фильтр серьёзных интеграторов на входе в регион</div></div>
      <div class="kpi-box"><div class="kpi-num">0 ₽</div><div class="kpi-label">Затраты на маркетинг региона</div><div class="kpi-sub">Партнёр сам развивает продажи и 1-ю линию</div></div>
      <div class="kpi-box"><div class="kpi-num">150–300k ₽</div><div class="kpi-label">ARR с 1 среднего клиента</div><div class="kpi-sub">После 1-го года на доп. местах и поддержке</div></div>
    </div>
  </div>
  ${footerHtml(label, 5, total)}
</section>`,

        // 6. Масштаб рынка и сценарии роста
        `<section class="slide" data-slide="6" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">5. Потенциал рынка и прогноз выручки</div>
      <div class="slide-title">Расчётная модель масштабирования по РФ (89 субъектов)</div>
      <div class="slide-subtitle">Оценка на базе реестровой квоты (~146 региональных франшиз по 1 на 1 млн населения) и целевого пула СМБ/Enterprise РФ</div>
    </div>
    <span class="badge-pill">Математическая модель</span>
  </div>
  <div class="slide-body">
    <table class="compact-table">
      <thead><tr><th>Показатель</th><th>Консервативный сценарий (Год 1)</th><th>Базовый сценарий (Год 2)</th><th>Целевой масштаб (Год 3)</th></tr></thead>
      <tbody>
        <tr><td><strong>Активные региональные франчайзи</strong></td><td>15 регионов</td><td>45 регионов</td><td>90+ слотов по РФ</td></tr>
        <tr><td><strong>Выручка от паушальных взносов</strong></td><td>~8 млн ₽</td><td>~22 млн ₽</td><td>~45 млн ₽</td></tr>
        <tr><td><strong>Новые внедрения (ПАК + базовые лицензии)</strong></td><td>25 клиентов (~100 млн ₽ вал)</td><td>90 клиентов (~360 млн ₽ вал)</td><td>220 клиентов (~880 млн ₽ вал)</td></tr>
        <tr><td><strong>Чистая лицензионная выручка ООО «БИС» (с учётом скидок партнёров)</strong></td><td><strong>~78 млн ₽</strong></td><td><strong>~260 млн ₽</strong></td><td><strong>~590 млн ₽</strong></td></tr>
        <tr><td><strong>Рекуррентный портфель (ARR доп. мест + SLA)</strong></td><td>~6 млн ₽/год</td><td>~24 млн ₽/год</td><td>~65 млн ₽/год</td></tr>
      </tbody>
    </table>
    <div class="banner green-banner"><strong>Эффект рычага:</strong> даже 2 продажи на одного партнёра в год при 45 активных франчайзи дают 90 корпоративных инсталляций в год при минимальной операционной нагрузке на центральную команду ООО «БИС».</div>
  </div>
  ${footerHtml(label, 6, total)}
</section>`,

        // 7. Текущая готовность (Traction & Tech Readiness)
        `<section class="slide" data-slide="7" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">6. Текущая готовность (TRL 9)</div>
      <div class="slide-title">Всё ключевое уже разработано, протестировано и готово к тиражированию</div>
      <div class="slide-subtitle">Инвестиции направляются в маркетинг, привлечение франчайзи и ускорение коммерческой экспансии, а не в «долгий R&D»</div>
    </div>
    <span class="badge-pill green">Готовность к продажам 100%</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card white green-left">
        <div class="card-head"><div class="card-title">Ядро ODANT-WORK</div><span class="tag green">В npm</span></div>
        <ul>
          <li>Пакет <code>odant-work</code> публикуется и автообновляется из npm с сохранением БД и настроек клиентов.</li>
          <li>Полный учёт, встроенный офис, федерация серверов <code>NODES</code>.</li>
        </ul>
      </div>
      <div class="card white green-left">
        <div class="card-head"><div class="card-title">Локальный ИИ стек</div><span class="tag green">Оптимизирован</span></div>
        <ul>
          <li>8 моделей (<code>Qwen3.8-Flash-Next</code>, <code>Qwen3-4B/0.6B</code>, <code>ASR</code>, <code>Silero</code>, <code>Z-Image-Turbo</code>, <code>BGE</code>).</li>
          <li>Единый ROCm-рантайм, автопрогрев и 13 ролевых ИИ-агентов.</li>
        </ul>
      </div>
      <div class="card white green-left">
        <div class="card-head"><div class="card-title">Биллинг и Франшиза</div><span class="tag green">В продакшене</span></div>
        <ul>
          <li>Портал <code>work.odant.org</code>, ЮKassa (54-ФЗ), автоактивация лицензий и франшиз.</li>
          <li>Админка с ботами MAX и Telegram для оперативного контроля.</li>
        </ul>
      </div>
    </div>
    <div class="banner"><strong>Группа компаний:</strong> стратегическая синергия с интегратором ООО «Инфостандарт» обеспечивает доступ к крупным корпоративным и инфраструктурным контрактам.</div>
  </div>
  ${footerHtml(label, 7, total)}
</section>`,

        // 8. Дорожная карта и использование инвестиций
        `<section class="slide" data-slide="8" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">7. Дорожная карта и фокус капитализации</div>
      <div class="slide-title">План коммерческой экспансии 2026–2027</div>
      <div class="slide-subtitle">Куда направляются ресурсы инвестора и какие рубежи открывают кратный рост оценки ООО «БИС»</div>
    </div>
    <span class="badge-pill">2026 → 2027</span>
  </div>
  <div class="slide-body">
    <div class="flow-row">
      <div class="flow-step"><div class="step-num">Q4 2026</div><div class="step-title">Запуск сети и первые 15 регионов</div><p>Первые продажи ПАК, привлечение 15 региональных ИТ-интеграторов через невозвратный залог 100 тыс. ₽.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">H1 2027</div><div class="step-title">Сертификация и отраслевые пакеты</div><p>Выпуск отраслевых конфигураций (торговля, производство, ЖКХ) и масштабирование до 45 регионов РФ.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">H2 2027</div><div class="step-title">Выход на 200+ инсталляций</div><p>Рост рекуррентного ARR доп. мест/SLA, федеративный обмен между компаниями на базе NODES.</p></div>
      <div class="flow-arrow">→</div>
      <div class="flow-step"><div class="step-num">2028+</div><div class="step-title">Лидерство в сегменте On-Prem AI ERP</div><p>ЕАЭС и дружественные рынки; стратегический M&amp;A / дивидендная модель с высокой маржой.</p></div>
    </div>
    <div class="grid-3">
      <div class="card white accent-left"><div class="card-title">45% · Партнёрский канал и маркетинг</div><p>Привлечение ИТ-интеграторов в 89 субъектах РФ, отраслевые форумы и генерация B2B-лидов.</p></div>
      <div class="card white accent-left"><div class="card-title">35% · Продукт и отраслевые модули</div><p>Углубление ИИ-навыков, коннекторов к корпоративным ERP, мобильных и голосовых сценариев.</p></div>
      <div class="card white accent-left"><div class="card-title">20% · Центр обучения и демо-стенд</div><p>Кластер стендов Ryzen AI Max+ PRO 495 для пилотов крупных заказчиков и аттестации партнёров.</p></div>
    </div>
  </div>
  ${footerHtml(label, 8, total)}
</section>`,

        // 9. Предложение инвестору и контакты
        `<section class="slide dark" data-slide="9" data-section="investors">
  <div class="slide-header">
    <div class="header-left">
      <div class="kicker">8. Инвестиционное предложение</div>
      <div class="slide-title">Открыты к стратегическому партнёрству и раунду развития</div>
      <div class="slide-subtitle">Гибкая структура сделки: доля в ООО «БИС» или проектное соинвестирование в коммерциализацию ODANT-WORK</div>
    </div>
    <span class="badge-pill dark-pill">Прямой диалог с основателем</span>
  </div>
  <div class="slide-body">
    <div class="grid-3">
      <div class="card dark-box"><div class="card-title">Условия входа в сделку</div><p>Сумма раунда, оценка компании и доля инвестора (или формат конвертируемого/проектного партнёрства) <strong>обсуждаются индивидуально по запросу</strong> на переговорах.</p></div>
      <div class="card dark-box"><div class="card-title">Прозрачность и отчётность</div><p>Вся операционная экономика (регистрации, платежи ЮKassa, выданные лицензии, статусы 89 регионов) отслеживается в реальном времени.</p></div>
      <div class="card dark-box"><div class="card-title">Следующий шаг</div><p>Личная встреча с директором ООО «БИС», демонстрация живого ПАК ODANT-WORK и предоставление финансовой модели / дата-рума.</p></div>
    </div>
    <div class="banner" style="background:rgba(255,255,255,0.08);border-color:rgba(125,211,252,0.4);color:#e0f2fe;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4mm;">
      <div><strong style="color:#ffffff;">Контактное лицо:</strong> Перепелкин Роман Александрович, директор <strong>ООО «БИС»</strong> (ИНН 6234049193) · г. Рязань, ул. Ленина, 47</div>
      <div><strong style="color:#ffffff;">Тел.:</strong> +7 (910) 642-39-14 · +7 (4912) 77-70-21 · <strong style="color:#ffffff;">Email:</strong> <span style="color:#38bdf8;font-weight:700;">proman@artbis.ru</span></div>
    </div>
  </div>
  ${footerHtml(label, 9, total)}
</section>`,
    ].join('\n');

    return wrapDeck({
        title: 'ODANT-WORK — презентация для инвесторов (ООО «БИС»)',
        deckLabel: label,
        slidesHtml: slides,
    });
}

function findHeadlessBrowser() {
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return '';
}

function renderPdfViaBrowser(browserPath, htmlPath, pdfPath) {
    const url = 'file:///' + htmlPath.replace(/\\/g, '/');
    const userDataDir = path.join(assetsDir, '.edge-pdf-tmp-' + process.pid);
    try {
        execFileSync(browserPath, [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            `--user-data-dir=${userDataDir}`,
            '--no-pdf-header-footer',
            `--print-to-pdf=${pdfPath}`,
            url,
        ], { stdio: 'pipe', timeout: 45000 });
    }
    finally {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

const specs = [
    { key: 'clients', html: 'ODANT-WORK-clients-presentation.html', pdf: 'ODANT-WORK-clients-presentation.pdf', build: buildClientsPresentation },
    { key: 'franchise', html: 'ODANT-WORK-franchise-presentation.html', pdf: 'ODANT-WORK-franchise-presentation.pdf', build: buildFranchisePresentation },
    { key: 'investors', html: 'ODANT-WORK-investors-presentation.html', pdf: 'ODANT-WORK-investors-presentation.pdf', build: buildInvestorsPresentation },
];

const browserExe = findHeadlessBrowser();
if (!browserExe) {
    console.warn('Warning: Edge/Chrome not found — PDF files will not be regenerated.');
}

fs.mkdirSync(docsDir, { recursive: true });

for (const s of specs) {
    const htmlContent = s.build();
    const assetHtmlPath = path.join(assetsDir, s.html);
    const assetPdfPath = path.join(assetsDir, s.pdf);
    fs.writeFileSync(assetHtmlPath, htmlContent, 'utf8');
    fs.writeFileSync(path.join(docsDir, s.html), htmlContent, 'utf8');
    console.log('Generated HTML:', assetHtmlPath);

    if (browserExe) {
        renderPdfViaBrowser(browserExe, assetHtmlPath, assetPdfPath);
        if (fs.existsSync(assetPdfPath)) {
            fs.copyFileSync(assetPdfPath, path.join(docsDir, s.pdf));
            const sizeKb = Math.round(fs.statSync(assetPdfPath).size / 1024);
            console.log(`Generated PDF:  ${assetPdfPath} (${sizeKb} KB)`);
        }
    }
}
