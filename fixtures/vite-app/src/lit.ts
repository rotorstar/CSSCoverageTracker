import { css, html, LitElement } from 'lit'

class FancyCard extends LitElement {
  static override styles = css`
    .title { color: rebeccapurple; }
    .unused-in-shadow { color: red; }
    :host([hidden]) { display: none; }
  `
  override render() {
    return html`<h2 class="title">Shadow DOM title</h2>`
  }
}
customElements.define('fancy-card', FancyCard)
