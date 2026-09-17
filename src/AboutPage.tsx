export function AboutPage() {
  return (
    <main className="info-page" id="main-content">
      <div className="info-page__intro">
        <span className="section-kicker">About Home Huddle</span>
        <h1>Make room for everyone’s day.</h1>
        <p>
          Home Huddle is an independent Alexa+ concept that turns a household
          conversation into a schedule people can share and revise.
        </p>
        <a className="info-page__start" href="./">
          Start planning <span aria-hidden="true">→</span>
        </a>
      </div>

      <div className="info-page__details">
        <section>
          <h2>How it works</h2>
          <p>
            Choose an example or describe who is involved, what needs doing,
            and your time window. When a plan is ready, its calendar appears
            below the chat. Later changes are proposals you can apply, keep,
            or undo after applying.
          </p>
        </section>
        <section>
          <h2>What this demo is</h2>
          <p>
            Amazon Bedrock helps draft the schedule. This is a concept demo,
            not an Amazon product. The displayed checklist shows what was
            checked; for free text it reflects the model’s interpretation and
            may omit something you said. Review it before relying on a plan.
          </p>
        </section>
        <section>
          <h2>Your information</h2>
          <p>
            Use fictional details. Messages and plans are saved in this
            browser, while planning requests are sent to Amazon Bedrock. The
            New plan button clears the saved conversation on this device.
            Calendar files are downloads, not live sync. If you choose to create
            a view link, only a read-only plan snapshot is stored for seven days.
            Anyone with the link can view it until it expires.
          </p>
        </section>
      </div>

      <a className="info-page__source" href="https://github.com/andrewodom18/home-huddle">
        View the project source <span aria-hidden="true">↗</span>
      </a>
    </main>
  );
}
