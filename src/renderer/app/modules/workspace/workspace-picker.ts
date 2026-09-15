import { Component, inject } from '@angular/core';
import { Workspace } from './workspace';
import { Version } from '../version';

@Component({
  selector: 'app-workspace-picker',
  templateUrl: './workspace-picker.html',
  styleUrl: './workspace-picker.css',
})
export class WorkspacePicker {
  protected readonly workspace = inject(Workspace);
  protected readonly version = inject(Version);
}
