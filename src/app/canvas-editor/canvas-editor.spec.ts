import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CanvasEditor } from './canvas-editor';

describe('CanvasEditor', () => {
  let component: CanvasEditor;
  let fixture: ComponentFixture<CanvasEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CanvasEditor]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CanvasEditor);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
