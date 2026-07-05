(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE } = window.BRX.config;
  const { refs } = window.BRX.ui;
  const { format, toNumber, currentRate } = window.BRX.utils;
  let activeSide = "buy";
  let editing = false;

  function renderLanding(scrollTarget = null) {
    refs.app.innerHTML = `
      <div class="landing landing-redesign">
        <section class="landing-hero-v4">
          <div class="landing-hero-grid">
            <div class="hero-copy hero-v4-copy">
              <div class="hero-kicker"><span></span>ETB / USDT P2P exchange</div>
              <h1>Trade USDT with Ethiopian Birr.</h1>
              <p class="hero-text">BRX connects verified ETB traders with escrow-protected USDT settlement on BEP20.</p>

              <div class="hero-actions hero-v4-actions">
                <a class="primary-button large" href="#/register">Get started</a>
                <a class="secondary-button large" href="#/market">View market</a>
              </div>

              <div class="hero-proof-row hero-v4-proof" aria-label="BRX operating highlights">
                <div><strong>185</strong><span>ETB reference</span></div>
                <div><strong>15</strong><span>BEP20 confirmations</span></div>
                <div><strong>Escrow</strong><span>Internal ledger</span></div>
              </div>
            </div>

            <aside class="hero-exchange-panel" aria-label="BRX exchange preview">
              <header class="exchange-panel-head">
                <div>
                  <span>BRX market</span>
                  <strong>ETB/USDT</strong>
                </div>
                <em><i></i>Live</em>
              </header>

              <div class="exchange-rate-strip">
                <span>Reference rate</span>
                <strong>1 USDT = <b id="rateText">${format(RATE)} ETB</b></strong>
              </div>

              <section class="hero-rate-panel hero-panel-section" aria-label="ETB USDT rate calculator">
                <div class="segmented hero-segmented">
                  <button class="active" type="button" data-side="buy">Buy USDT</button>
                  <button type="button" data-side="sell">Sell USDT</button>
                </div>
                <div class="trade-inputs hero-trade-inputs">
                  <label class="input-box">
                    <span id="payLabel">Pay</span>
                    <input id="etbInput" value="10000" inputmode="decimal" aria-label="ETB amount" />
                    <b>ETB</b>
                  </label>
                  <label class="input-box">
                    <span id="receiveLabel">Receive</span>
                    <input id="usdtInput" value="54.05" inputmode="decimal" aria-label="USDT amount" />
                    <b>USDT</b>
                  </label>
                </div>
              </section>

              <div class="market-preview-list" aria-label="Sample market offers">
                <div class="market-preview-row"><span>Seller</span><strong>185.00 ETB</strong><em>Telebirr</em></div>
                <div class="market-preview-row"><span>Seller</span><strong>186.25 ETB</strong><em>CBE Birr</em></div>
                <div class="market-preview-row muted-row"><span>Buyer</span><strong>184.00 ETB</strong><em>Bank</em></div>
              </div>

              <footer class="exchange-panel-foot">
                <span>Escrow locked</span>
                <span>Bank transfer</span>
                <span>USDT BEP20</span>
              </footer>
            </aside>
          </div>
        </section>

        <section class="section landing-band" id="features">
          <div class="section-head"><div><p class="eyebrow">Features</p><h2>Built for a real ETB/USDT desk.</h2></div></div>
          <div class="feature-grid landing-feature-grid">
            <article class="feature-card"><h3>Custodial wallet rail</h3><p>USDT deposits and withdrawals start on BNB Smart Chain while P2P trades settle internally.</p></article>
            <article class="feature-card"><h3>Ledger escrow</h3><p>Seller funds move from available to locked when a buyer opens a trade, then release after payment confirmation.</p></article>
            <article class="feature-card"><h3>Manual review</h3><p>KYC, disputes, withdrawals, and limits are controlled from the BRX admin console.</p></article>
          </div>
        </section>

        <section class="section landing-band" id="how-it-works">
          <div class="section-head"><div><p class="eyebrow">How it works</p><h2>Four steps from quote to release.</h2></div><a class="primary-button" href="#/register">Get started</a></div>
          <div class="steps-grid landing-steps-grid">
            <article class="step-card"><span>01</span><h3>Create account</h3><p>Sign up and verify your email before wallet access.</p></article>
            <article class="step-card"><span>02</span><h3>Open a trade</h3><p>Choose an ETB offer and BRX locks seller USDT in escrow.</p></article>
            <article class="step-card"><span>03</span><h3>Pay seller</h3><p>Send ETB outside BRX using Telebirr, CBE Birr, or bank.</p></article>
            <article class="step-card"><span>04</span><h3>Receive USDT</h3><p>Seller confirms payment and escrow releases internally.</p></article>
          </div>
        </section>
      </div>
    `;
    bindCalculator();
    if (scrollTarget) window.setTimeout(() => document.querySelector(`#${scrollTarget}`)?.scrollIntoView(), 40);
  }

  function bindCalculator() {
    const sideButtons = document.querySelectorAll("[data-side]");
    const etbInput = document.querySelector("#etbInput");
    const usdtInput = document.querySelector("#usdtInput");
    const payLabel = document.querySelector("#payLabel");
    const receiveLabel = document.querySelector("#receiveLabel");
    const rateText = document.querySelector("#rateText");

    function updateFromEtb() {
      if (editing) return;
      editing = true;
      usdtInput.value = format(toNumber(etbInput.value) / currentRate(activeSide), 2);
      editing = false;
    }

    function updateFromUsdt() {
      if (editing) return;
      editing = true;
      etbInput.value = format(toNumber(usdtInput.value) * currentRate(activeSide), 2);
      editing = false;
    }

    function setSide(side) {
      activeSide = side;
      sideButtons.forEach((button) => button.classList.toggle("active", button.dataset.side === side));
      payLabel.textContent = side === "buy" ? "Pay" : "Receive";
      receiveLabel.textContent = side === "buy" ? "Receive" : "Sell";
      rateText.textContent = `${format(currentRate(activeSide))} ETB`;
      updateFromEtb();
    }

    sideButtons.forEach((button) => button.addEventListener("click", () => setSide(button.dataset.side)));
    etbInput.addEventListener("input", updateFromEtb);
    usdtInput.addEventListener("input", updateFromUsdt);
    updateFromEtb();
  }

  window.BRX.pages.renderLanding = renderLanding;
})();
