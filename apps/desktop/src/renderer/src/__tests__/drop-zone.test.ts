import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { DropZone } from '../components/DropZone';

describe('DropZone', () => {
  let onFolderDrop: Mock<(folderPath: string) => void>;

  beforeEach(() => {
    onFolderDrop = vi.fn<(folderPath: string) => void>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderDropZone() {
    // `children` goes in the props object, not as a createElement vararg:
    // DropZoneProps declares it required, and React's typings expect every
    // declared prop to be present in that first argument.
    return render(
      createElement(DropZone, {
        onFolderDrop,
        children: createElement('div', { 'data-testid': 'content' }, 'Content'),
      }),
    );
  }

  function createDragEvent(
    type: string,
    options: Partial<{
      items: Array<{ webkitGetAsEntry: () => { isDirectory: boolean } }>;
      files: Array<{ path: string }>;
    }> = {},
  ) {
    const items = options.items ?? [];
    const files = options.files ?? [];
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        items: items as unknown as DataTransferItemList,
        files: files as unknown as FileList,
      },
    };
  }

  it('renders children', () => {
    const { getByTestId } = renderDropZone();
    expect(getByTestId('content')).toBeTruthy();
  });

  it('shows overlay on drag-over', () => {
    const { getByTestId, queryByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    expect(queryByTestId('drop-overlay')).toBeNull();

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));
    expect(getByTestId('drop-overlay')).toBeTruthy();
    expect(getByTestId('drop-overlay').textContent).toContain('Drop folder to open');
  });

  it('hides overlay on drag-leave', () => {
    const { getByTestId, queryByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));
    expect(getByTestId('drop-overlay')).toBeTruthy();

    fireEvent.dragLeave(zone, createDragEvent('dragleave'));
    expect(queryByTestId('drop-overlay')).toBeNull();
  });

  it('calls onFolderDrop when directory is dropped', () => {
    const { getByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));

    const dropEvent = createDragEvent('drop', {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      files: [{ path: '/Users/test/photos' }],
    });

    fireEvent.drop(zone, dropEvent);
    expect(onFolderDrop).toHaveBeenCalledWith('/Users/test/photos');
  });

  it('shows error when file (not directory) is dropped', () => {
    const { getByTestId, queryByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));

    const dropEvent = createDragEvent('drop', {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      files: [{ path: '/Users/test/photo.jpg' }],
    });

    fireEvent.drop(zone, dropEvent);
    expect(onFolderDrop).not.toHaveBeenCalled();
    expect(getByTestId('drop-error').textContent).toBe('Drop a folder, not a file');
  });

  it('error message auto-dismisses after 3 seconds', () => {
    const { getByTestId, queryByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));

    const dropEvent = createDragEvent('drop', {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      files: [{ path: '/Users/test/photo.jpg' }],
    });

    fireEvent.drop(zone, dropEvent);
    expect(getByTestId('drop-error')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(queryByTestId('drop-error')).toBeNull();
  });

  it('hides overlay on drop', () => {
    const { getByTestId, queryByTestId } = renderDropZone();
    const zone = getByTestId('drop-zone');

    fireEvent.dragEnter(zone, createDragEvent('dragenter'));
    expect(getByTestId('drop-overlay')).toBeTruthy();

    const dropEvent = createDragEvent('drop', {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      files: [{ path: '/Users/test/photos' }],
    });

    fireEvent.drop(zone, dropEvent);
    expect(queryByTestId('drop-overlay')).toBeNull();
  });
});
