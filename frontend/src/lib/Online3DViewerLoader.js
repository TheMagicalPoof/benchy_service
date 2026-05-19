import { ImportSettings, InputFilesFromFileObjects, ThreeModelLoader } from 'online-3d-viewer';

export const online3DViewerExtensions = [
	'.3dm',
	'.3ds',
	'.bim',
	'.dae',
	'.fbx',
	'.fcstd',
	'.gltf',
	'.glb',
	'.ifc',
	'.off',
	'.wrl',
	'.zip'
];

export function canLoadWithOnline3DViewer(file) {
	const fileName = file?.name?.toLowerCase?.() || '';
	return online3DViewerExtensions.some((extension) => fileName.endsWith(extension));
}

export function loadWithOnline3DViewer(file) {
	return new Promise((resolve, reject) => {
		const loader = new ThreeModelLoader();
		const settings = new ImportSettings();
		const inputFiles = InputFilesFromFileObjects([file]);

		loader.LoadModel(inputFiles, settings, {
			onLoadStart: () => {},
			onFileListProgress: () => {},
			onFileLoadProgress: () => {},
			onImportStart: () => {},
			onVisualizationStart: () => {},
			onTextureLoaded: () => {},
			onModelFinished: (_importResult, object3D) => {
				loader.Destroy();
				resolve(object3D);
			},
			onLoadError: (importError) => {
				loader.Destroy();
				reject(new Error(formatOnline3DViewerError(importError, file.name)));
			}
		});
	});
}

function formatOnline3DViewerError(importError, fileName) {
	const details = importError?.message ? `: ${importError.message}` : '';
	return `Failed to import file through Online3DViewer: ${fileName}${details}`;
}
