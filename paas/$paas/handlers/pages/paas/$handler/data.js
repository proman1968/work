export default{
        template: /* html */`
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: auto;
            }
        </style>
        <paas-form :$item flex></paas-form>
    `,
}
ODA({is: 'paas-form',
    template:/* html */`

<style>
    :host{
        overflow: visible;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: #fafcff;
      color: #1a2c3e;
      line-height: 1.4;
      scroll-behavior: smooth;
    }

    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 32px;
    }

    /* header / nav */
    .navbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      flex-wrap: wrap;
      gap: 20px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      background: linear-gradient(135deg, #2266dc, #0a3e7c);
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      color: white;
      box-shadow: 0 8px 20px rgba(34, 102, 220, 0.25);
    }

    .logo-text {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(120deg, #1f3b4c, #2266dc);
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
    }

    .nav-links {
      display: flex;
      gap: 32px;
      align-items: center;
    }

    .nav-links a {
      text-decoration: none;
      font-weight: 500;
      color: #2c4c6e;
      transition: 0.2s;
    }

    .nav-links a:hover {
      color: #2266dc;
    }

    .btn-outline {
      border: 1.5px solid #2266dc;
      background: transparent;
      padding: 10px 22px;
      border-radius: 40px;
      font-weight: 600;
      color: #2266dc;
      cursor: pointer;
      transition: 0.2s;
      font-family: inherit;
    }

    .btn-outline:hover {
      background: #eef4ff;
    }

    .btn-primary {
      background: #2266dc;
      border: none;
      padding: 12px 28px;
      border-radius: 40px;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: 0.2s;
      font-family: inherit;
      box-shadow: 0 4px 10px rgba(34, 102, 220, 0.3);
    }

    .btn-primary:hover {
      background: #0e4bb0;
      transform: translateY(-2px);
    }

    .btn-large {
      padding: 14px 36px;
      font-size: 1.05rem;
    }

    /* hero */
    .hero {
      padding: 70px 0 60px 0;
    }

    .hero-grid {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 48px;
    }

    .hero-left {
      flex: 1.2;
    }

    .hero-right {
      flex: 1;
      background: linear-gradient(145deg, #eef3fe, #ffffff);
      border-radius: 48px;
      padding: 24px;
      text-align: center;
      box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.05);
    }

    .badge {
      display: inline-block;
      background: #e9f0fe;
      color: #2266dc;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 40px;
      margin-bottom: 24px;
    }

    .hero h1 {
      font-size: 3.5rem;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -1px;
      margin-bottom: 24px;
      background: linear-gradient(to right, #1a2c3e, #2266dc);
      background-clip: text;
      -webkit-background-clip: text;
      color: transparent;
    }

    .hero-desc {
      font-size: 1.2rem;
      color: #4a627a;
      margin-bottom: 32px;
      max-width: 90%;
      line-height: 1.5;
    }

    .cta-group {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    .hero-stats {
      margin-top: 40px;
      display: flex;
      gap: 32px;
    }

    .stat p:first-child {
      font-size: 1.8rem;
      font-weight: 800;
      color: #1f3b4c;
    }

    .hero-right img {
      max-width: 100%;
      border-radius: 32px;
      background: #ffffffdd;
    }

    .mock-ui {
      background: #ffffff;
      border-radius: 32px;
      box-shadow: 0 25px 45px -12px rgba(0, 0, 0, 0.2);
      overflow: hidden;
      text-align: left;
    }

    .mock-header {
      background: #f1f5f9;
      padding: 16px 20px;
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
    }

    .mock-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #e2e8f0;
    }

    .mock-dot.red { background: #ff5f56; }
    .mock-dot.yellow { background: #ffbd2e; }
    .mock-dot.green { background: #27c93f; }

    .mock-content {
      padding: 24px;
      background: white;
    }

    .mock-message {
      display: flex;
      gap: 12px;
      margin-bottom: 18px;
    }

    .avatar {
      width: 38px;
      height: 38px;
      background: #2266dc20;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #2266dc;
    }

    .message-bubble {
      background: #f0f4fe;
      padding: 10px 16px;
      border-radius: 18px;
      max-width: 80%;
    }

    /* features */
    .features {
      padding: 80px 0;
      background: #ffffff;
    }

    .section-title {
      text-align: center;
      font-size: 2.3rem;
      font-weight: 700;
      margin-bottom: 16px;
    }

    .section-sub {
      text-align: center;
      color: #5a6e85;
      max-width: 620px;
      margin: 0 auto 56px auto;
      font-size: 1.1rem;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 40px;
    }

    .feature-card {
      background: #f9fbfe;
      border-radius: 32px;
      padding: 32px 24px;
      transition: 0.25s ease;
      border: 1px solid #ecf3fa;
    }

    .feature-card:hover {
      transform: translateY(-6px);
      border-color: #cddff5;
      box-shadow: 0 20px 30px -15px rgba(0,0,0,0.05);
    }

    .feature-icon {
      font-size: 2.5rem;
      color: #2266dc;
      margin-bottom: 24px;
    }

    .feature-card h3 {
      font-size: 1.5rem;
      margin-bottom: 12px;
    }

    /* PaaS размет */
    .paas-section {
      background: linear-gradient(110deg, #f2f7ff 0%, #ffffff 100%);
      padding: 80px 0;
      border-radius: 0;
    }

    .paas-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 48px;
      align-items: center;
    }

    .paas-info {
      flex: 1;
    }

    .paas-info h2 {
      font-size: 2rem;
      margin-bottom: 20px;
    }

    .paas-list {
      list-style: none;
      margin: 30px 0;
    }

    .paas-list li {
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .paas-list i {
      color: #2266dc;
      font-size: 1.3rem;
    }

    .paas-visual {
      flex: 0.9;
      background: #fff;
      border-radius: 32px;
      padding: 20px;
      box-shadow: 0 20px 35px -12px rgba(0,0,0,0.08);
      border: 1px solid #e9edf2;
    }

    /* pricing demo */
    .pricing {
      padding: 80px 0;
      background: #ffffff;
    }

    .price-cards {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 32px;
      margin-top: 40px;
    }

    .price-card {
      background: white;
      border-radius: 40px;
      padding: 32px;
      width: 300px;
      border: 1px solid #e2edfc;
      transition: 0.2s;
    }

    .price-card.popular {
      border: 2px solid #2266dc;
      box-shadow: 0 20px 35px -12px rgba(34,102,220,0.2);
      background: #ffffff;
    }

    .price-card h3 {
      font-size: 1.8rem;
      font-weight: 700;
    }
    .price {
      font-size: 2.5rem;
      font-weight: 800;
      margin: 20px 0 8px;
    }
    .price small {
      font-size: 1rem;
      font-weight: 400;
    }
    .price-card ul {
      margin: 28px 0;
      list-style: none;
    }
    .price-card li {
      padding: 8px 0;
      display: flex;
      gap: 10px;
      align-items: center;
    }

    /* cta banner */
    .cta-banner {
      background: #0f2b3f;
      border-radius: 48px;
      margin: 40px auto 70px;
      padding: 56px 48px;
      text-align: center;
      color: white;
    }
    .cta-banner h2 {
      font-size: 2rem;
    }

    /* footer */
    footer {
      border-top: 1px solid #e2edf2;
      padding: 48px 0 32px;
      color: #5b6f87;
    }

    .footer-grid {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 32px;
    }

    @media (max-width: 800px) {
      .hero h1 { font-size: 2.5rem; }
      .container { padding: 0 24px; }
      .navbar { flex-direction: column; align-items: flex-start; }
      .hero-desc { max-width: 100%; }
      .cta-group { justify-content: center; }
    }
  </style>
  
  
 <div class="container">
    <!-- Navigation -->
    <div class="navbar">
      <div class="logo">
        <oda-icon icon="/sources/odant.png"></oda-icon>
        <div class="logo-text">ODANT-WORK</div>
      </div>
      <div class="nav-links">
        <a href="#features">Возможности</a>
        <a href="#paas">PaaS платформа</a>
        <a href="#pricing">Тарифы</a>
        <button class="btn-outline" id="demoBtn">Демо-доступ</button>
        <button class="btn-primary" id="getStartedBtn">Начать</button>
      </div>
    </div>

    <!-- Hero -->
    <div class="hero">
      <div class="hero-grid">
        <div class="hero-left">
          <div class="badge"><i class="fas fa-crown"></i> PaaS для бизнеса</div>
          <h1>Корпоративный мессенджер<br>WORK — безопасно, гибко, масштабируемо</h1>
          <p class="hero-desc">Белая этикетка, собственный брендинг, интеграции и полный контроль данных. Постройте экосистему коммуникаций на нашей PaaS-платформе.</p>
          <div class="cta-group">
            <button class="btn-primary btn-large" id="heroCta">Попробовать бесплатно</button>
            <button class="btn-outline btn-large" id="watchDemo">Смотреть обзор</button>
          </div>
          <div class="hero-stats">
            <div class="stat"><p>5000+</p><span>компаний</span></div>
            <div class="stat"><p>99.99%</p><span>uptime SLA</span></div>
            <div class="stat"><p><i class="fas fa-shield-alt"></i> ISO 27001</p><span>сертификат</span></div>
          </div>
        </div>
        <div class="hero-right">
          <div class="mock-ui">
            <div class="mock-header">
              <div class="mock-dot red"></div>
              <div class="mock-dot yellow"></div>
              <div class="mock-dot green"></div>
              <span style="margin-left: 12px; font-size: 13px; color:#5f7d9c;">WORK команда · Каналы</span>
            </div>
            <div class="mock-content">
              <div class="mock-message">
                <div class="avatar"><i class="fas fa-user-tie"></i></div>
                <div class="message-bubble"><strong>Анна (DevOps)</strong><br>Платформа готова к кастомным интеграциям через API</div>
              </div>
              <div class="mock-message">
                <div class="avatar"><i class="fas fa-code"></i></div>
                <div class="message-bubble"><strong>PaaS Bot</strong><br>✅ Новый модуль AI-ассистента развернут за 5 минут</div>
              </div>
              <div class="mock-message">
                <div class="avatar"><i class="fas fa-chart-line"></i></div>
                <div class="message-bubble"><strong>Аналитика</strong><br>Создано 12 чат-ботов на базе WORK Flow</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Features Section -->
  <div id="features" class="features">
    <div class="container">
      <h2 class="section-title">Всё для продуктивной коммуникации</h2>
      <p class="section-sub">Готовые модули + PaaS-инструменты: создавайте свои решения поверх мессенджера.</p>
      <div class="features-grid">
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-puzzle-piece"></i></div><h3>Кастомизация</h3><p>Логотип, цвета, домен, своя мобильная версия — полностью white label.</p></div>
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-cloud-upload-alt"></i></div><h3>Self-hosted PaaS</h3><p>Размещайте в своём облаке или в защищённом контуре — AWS, GCP, on-premise.</p></div>
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-robot"></i></div><h3>AI & Боты</h3><p>Встроенный no-code конструктор ботов и готовые LLM-интеграции.</p></div>
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-chalkboard-user"></i></div><h3>Видеоконференции</h3><p>HD-качество, запись встреч, шумоподавление и до 500 участников.</p></div>
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-shield-haltered"></i></div><h3>E2EE + SSO</h3><p>Сквозное шифрование, корпоративный SSO (SAML, OIDC), DLP-интеграция.</p></div>
        <div class="feature-card"><div class="feature-icon"><i class="fas fa-chart-simple"></i></div><h3>Аналитика PaaS</h3><p>Дашборды по вовлечённости, API для выгрузки логов и событий.</p></div>
      </div>
    </div>
  </div>

  <!-- PaaS платформа -->
  <div id="paas" class="paas-section">
    <div class="container paas-wrap">
      <div class="paas-info">
        <div class="badge"><i class="fas fa-microchip"></i> Платформа как услуга</div>
        <h2>WORK PaaS — ваш собственный мессенджер для команд любой сложности</h2>
        <p>Разрабатывайте, расширяйте и масштабируйте корпоративный чат без границ. Открытое API, webhooks и SDK для JS, Python, Go.</p>
        <ul class="paas-list">
          <li><i class="fas fa-check-circle"></i> Полный контроль данных и соответствие 152-ФЗ / GDPR</li>
          <li><i class="fas fa-check-circle"></i> Управление пользователями через SCIM и Active Directory</li>
          <li><i class="fas fa-check-circle"></i> Кастомные виджеты и встраиваемые приложения внутри чата</li>
          <li><i class="fas fa-check-circle"></i> Поддержка Kubernetes-деплоя и Helm-чарты</li>
        </ul>
        <button class="btn-primary" id="paasCta">Запросить индивидуальную демонстрацию</button>
      </div>
      <div class="paas-visual">
        <div style="background: #eef3ff; border-radius: 28px; padding: 20px; text-align:center;">
          <i class="fas fa-code-branch" style="font-size: 48px; color: #2266dc;"></i>
          <pre style="background:#0f212f; color:#c9f0ff; padding:16px; border-radius:20px; text-align:left; margin-top:16px; font-size:13px;"><code>// WORK PaaS API example
const work = new WorkClient({
  baseURL: "https://your-domain.work",
  apiKey: "wk_xxxx"
});
await work.channels.create("tech-news");
work.events.on("message", (msg) => {
  console.log("Новое сообщение", msg);
});</code></pre>
          <p style="margin-top: 16px;">Гибкое API для создания экосистемы</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Pricing -->
  <div id="pricing" class="pricing">
    <div class="container">
      <h2 class="section-title">Тарифы для бизнеса и PaaS-разработки</h2>
      <p class="section-sub">Начните с бесплатного пробного периода или выберите план под масштаб проекта</p>
      <div class="price-cards">
        <div class="price-card">
          <h3>Старт</h3>
          <div class="price">₽0 <small>/ мес</small></div>
          <p>до 50 пользователей<br>базовый функционал</p>
          <ul>
            <li><i class="fas fa-check" style="color:#2266dc;"></i> 5 ГБ файлового хранилища</li>
            <li><i class="fas fa-check"></i> Групповые чаты</li>
            <li><i class="fas fa-check"></i> API ограниченный</li>
          </ul>
          <button class="btn-outline" style="width:100%;">Начать</button>
        </div>
        <div class="price-card popular">
          <div style="background:#2266dc10; padding:4px 12px; border-radius:40px; display:inline-block; font-size:12px; font-weight:600;">🔥 Самый популярный</div>
          <h3>Business PaaS</h3>
          <div class="price">₽499 <small>/ пользователь</small></div>
          <p>полный white label + PaaS</p>
          <ul>
            <li><i class="fas fa-check"></i> Неограниченные API-запросы</li>
            <li><i class="fas fa-check"></i> Кастомные боты & webhooks</li>
            <li><i class="fas fa-check"></i> SSO, DLP, аудит</li>
            <li><i class="fas fa-check"></i> Собственный брендинг и домен</li>
          </ul>
          <button class="btn-primary" style="width:100%;">Выбрать план</button>
        </div>
        <div class="price-card">
          <h3>Enterprise</h3>
          <div class="price">Индивидуально</div>
          <p>On‑premise / облако под ключ</p>
          <ul>
            <li><i class="fas fa-check"></i> Выделенный кластер</li>
            <li><i class="fas fa-check"></i> SLA 99.99%</li>
            <li><i class="fas fa-check"></i> Интеграция с CRM/ERP</li>
            <li><i class="fas fa-check"></i> Обучение и техподдержка 24/7</li>
          </ul>
          <button class="btn-outline" style="width:100%;">Связаться с отделом</button>
        </div>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="cta-banner">
      <h2>Готовы превратить коммуникации в драйвер роста?</h2>
      <p style="margin: 20px 0; font-size: 1.1rem;">Присоединяйтесь к 5000+ компаниям, которые выбрали WORK PaaS</p>
      <button class="btn-primary btn-large" id="bannerCta" style="background: white; color:#1f3b4c;">Запросить демо-доступ</button>
    </div>
  </div>

  <footer>
    <div class="container footer-grid">
      <div>
        <div class="logo" style="margin-bottom: 16px;"><div class="logo-icon" style="width:38px; height:38px; font-size:20px;"><i class="fas fa-comment-dots"></i></div><span style="font-weight:700; font-size: 1.3rem;">WORK.cloud</span></div>
        <p>© 2025 WORK PaaS. Все права защищены.</p>
      </div>
      <div><h4>Продукт</h4><p>Возможности<br>PaaS платформа<br>Безопасность</p></div>
      <div><h4>Ресурсы</h4><p>Документация API<br>Блог<br>Поддержка</p></div>
      <div><h4>Связаться</h4><p>hello@workpaas.com<br>+7 (495) 123-45-67</p></div>
    </div>
  </footer>

  <!-- Модальное уведомление (для демо-взаимодействия) -->
  <div id="notification" style="position: fixed; bottom: 28px; right: 28px; background: #1a2c3e; color: white; padding: 12px 24px; border-radius: 60px; font-weight: 500; box-shadow: 0 8px 20px rgba(0,0,0,0.2); z-index: 1000; transition: opacity 0.2s; opacity:0; pointer-events: none;"></div>
  
    `,
    
})