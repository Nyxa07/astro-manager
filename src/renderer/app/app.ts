import { Component, inject } from '@angular/core';
import { Workspace } from './modules/workspace/workspace';
import { WorkspacePicker } from './modules/workspace/workspace-picker';

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
  imports: [WorkspacePicker],
})
export class App {
  protected readonly workspace = inject(Workspace);
}
