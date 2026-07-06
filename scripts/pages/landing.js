(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { refs } = window.BRX.ui;

  function renderLanding(scrollTarget = null) {
    refs.app.innerHTML = `
      <div class="landing landing-redesign">
        <section class="landing-hero-v5">
          <div class="landing-hero-v5-grid">
            <div class="hero-copy hero-v5-copy">
              <p class="hero-kicker"><strong>BRX P2P</strong><span>Local ETB payments</span></p>
              <h1>Trade USDT with Ethiopian Birr.</h1>
              <p class="hero-text">Buy and sell USDT with verified Ethiopian payment methods, BRX escrow, and a BEP20 wallet built for local traders.</p>

              <div class="hero-actions hero-v5-actions">
                <a class="primary-button large" href="#/register">Sign up</a>
                <a class="secondary-button large" href="#/market">Explore market</a>
              </div>
            </div>

            <aside class="brx-phone-stage" aria-label="BRX mobile app preview">
              <div class="brx-phone-frame">
                <div class="brx-phone-speaker"></div>
                <div class="brx-phone-screen">
                  <div class="brx-phone-scroll">
                    <section class="phone-panel phone-home-panel">
                      <header class="phone-topbar">
                        <img src="./assets/brx-logo-transparent.png" alt="BRX" />
                        <span>Verified</span>
                      </header>
                      <div class="phone-balance">
                        <small>Total balance</small>
                        <strong>2,480.50 <span>USDT</span></strong>
                        <em>Available: 2,125.00 USDT</em>
                      </div>
                      <div class="phone-actions">
                        <span>Deposit</span>
                        <span>Withdraw</span>
                        <span>Transfer</span>
                      </div>
                    </section>

                    <section class="phone-panel phone-market-panel">
                      <div class="phone-section-head">
                        <strong>P2P Market</strong>
                        <span>ETB / USDT</span>
                      </div>
                      <div class="phone-tabs"><b>Buy</b><span>Sell</span></div>
                      <div class="phone-offer buy">
                        <i>HA</i>
                        <div><strong>Habesha Trade</strong><small>Telebirr - 97% completion</small></div>
                        <em>185.00</em>
                      </div>
                      <div class="phone-offer buy">
                        <i>CB</i>
                        <div><strong>CBE Desk</strong><small>CBE Birr - 2 min avg</small></div>
                        <em>185.40</em>
                      </div>
                      <div class="phone-offer sell">
                        <i>BR</i>
                        <div><strong>BRX Merchant</strong><small>Bank transfer - escrow ready</small></div>
                        <em>184.50</em>
                      </div>
                    </section>

                    <section class="phone-panel phone-trade-panel">
                      <div class="phone-section-head">
                        <strong>Escrow trade</strong>
                        <span>Order #BRX-2048</span>
                      </div>
                      <div class="phone-trade-amount">
                        <small>You receive</small>
                        <strong>150.00 USDT</strong>
                        <span>27,750 ETB via Telebirr</span>
                      </div>
                      <div class="phone-step done"><i></i><span>Seller USDT locked</span></div>
                      <div class="phone-step active"><i></i><span>Buyer payment pending</span></div>
                      <div class="phone-step"><i></i><span>Release to wallet</span></div>
                    </section>

                    <section class="phone-panel phone-wallet-panel">
                      <div class="phone-section-head">
                        <strong>Wallet</strong>
                        <span>BEP20</span>
                      </div>
                      <div class="phone-address">
                        <small>Deposit address</small>
                        <span>0x7B3...91A4</span>
                      </div>
                      <div class="phone-network-grid">
                        <span>USDT</span>
                        <span>BNB Smart Chain</span>
                        <span>15 confirmations</span>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section class="section landing-band" id="features">
          <div class="section-head"><div><p class="eyebrow">Security stack</p><h2>A focused desk for ETB and USDT.</h2></div></div>
          <div class="feature-grid landing-feature-grid">
            <article class="feature-card"><h3>Custodial wallet rail</h3><p>USDT deposits and withdrawals start on BNB Smart Chain while P2P trades settle internally.</p></article>
            <article class="feature-card"><h3>Ledger escrow</h3><p>Seller funds move from available to locked when a buyer opens a trade, then release after payment confirmation.</p></article>
            <article class="feature-card"><h3>Manual review</h3><p>KYC, disputes, withdrawals, and limits are controlled from the BRX admin console.</p></article>
          </div>
        </section>

        <section class="section landing-band" id="how-it-works">
          <div class="section-head"><div><p class="eyebrow">Trading flow</p><h2>From offer to release in four clear steps.</h2></div><a class="primary-button" href="#/register">Get started</a></div>
          <div class="steps-grid landing-steps-grid">
            <article class="step-card"><span>01</span><h3>Create account</h3><p>Sign up and verify your email before wallet access.</p></article>
            <article class="step-card"><span>02</span><h3>Open a trade</h3><p>Choose an ETB offer and BRX locks seller USDT in escrow.</p></article>
            <article class="step-card"><span>03</span><h3>Pay seller</h3><p>Send ETB outside BRX using Telebirr, CBE Birr, or bank.</p></article>
            <article class="step-card"><span>04</span><h3>Receive USDT</h3><p>Seller confirms payment and escrow releases internally.</p></article>
          </div>
        </section>
      </div>
    `;
    if (scrollTarget) window.setTimeout(() => document.querySelector(`#${scrollTarget}`)?.scrollIntoView(), 40);
  }

  window.BRX.pages.renderLanding = renderLanding;
})();
