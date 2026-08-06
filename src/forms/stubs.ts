// stubs.ts
import { ChildForm } from './ChildForm';

export class PlaceholderForm extends ChildForm {
  protected onInit() {
    this.setTitle(this.args.title ?? '준비중');
    this.html(`<div class="placeholder">
      <i class="codicon codicon-tools"></i>
      <h2>${this.args.title}</h2>
      <p>이 child form 은 다음 단계에서 구현합니다.<br/>
         <code>src/forms/</code> 에 클래스를 만들고 <code>registry.ts</code> 에서 교체하세요.</p>
    </div>`);
  }
}
