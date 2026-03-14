import { useState } from 'react';

function App(): React.JSX.Element {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const handleSelectFolder = async (): Promise<void> => {
    const folder = await window.api.selectFolder();
    setSelectedFolder(folder);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="mb-8 text-4xl font-bold">Photo Culler</h1>
      <p className="mb-6 text-gray-400">Select a folder to start culling photos</p>
      <button
        onClick={handleSelectFolder}
        className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-medium transition-colors hover:bg-blue-700"
      >
        Select Folder
      </button>
      {selectedFolder && (
        <p className="mt-6 text-sm text-gray-300">
          Selected: <span className="font-mono">{selectedFolder}</span>
        </p>
      )}
    </div>
  );
}

export default App;
