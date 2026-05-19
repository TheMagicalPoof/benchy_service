// Импортируем необходимые модули из Three.js
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import occtImportFactory from 'occt-import-js';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import {
	buildSkeletonPayload,
	calculateGeometryPayloadStats,
	calculatePrintVolumeEstimate,
	collectGeometryAnalysisPayload
} from './GeometryAnalysis.js';
import { serializeObject3D as serializeThreeObject3D } from './ThreeSerializer.js';

let occtImportPromise;
let activeRequestId = null;
let activeAnalysisMeshes = null;
let pendingSelectionDetails = null;

const OCCT_IMPORT_PARAMS = {
	linearUnit: 'millimeter',
	linearDeflectionType: 'bounding_box_ratio',
	linearDeflection: 0.001,
	angularDeflection: 0.5
};

// Устанавливаем обработчик сообщения от основного потока
self.onmessage = async (event) => {
	if (event.data?.type === 'analyze') {
		activeRequestId = event.data.requestId;
		activeAnalysisMeshes = event.data.meshes;
		scheduleBackgroundAnalysis(event.data.requestId, event.data.meshes, event.data.timing || {}, {
			analysisOptions: event.data.analysisOptions,
			includeSkeleton: true
		});
		flushPendingSelectionDetails(event.data.requestId);
		return;
	}

	if (event.data?.type === 'reanalyze') {
		activeRequestId = event.data.requestId;
		if (!activeAnalysisMeshes) return;
		scheduleBackgroundAnalysis(event.data.requestId, activeAnalysisMeshes, event.data.timing || {}, {
			analysisOptions: event.data.analysisOptions,
			includeSkeleton: false
		});
		return;
	}

	if (event.data?.type === 'selectionDetails') {
		if (event.data.requestId !== activeRequestId || !activeAnalysisMeshes) {
			pendingSelectionDetails = event.data;
			return;
		}
		scheduleSelectionDetails(
			event.data.requestId,
			event.data.selectionRequestId,
			event.data.meshIds,
			event.data.analysisOptions
		);
		return;
	}

	const file = event.data?.file || event.data;
	const requestId = event.data?.requestId;
	activeRequestId = requestId;
	activeAnalysisMeshes = null;
	pendingSelectionDetails = null;

	// const geometry = await loadGeometryFromFile(file); // Загружаем геометрию

	// const mg = new MeshGenerator(geometry);

	// mg.update();

	// // Предполагается, что у вас есть объект THREE.Mesh или THREE.LineSegments
	// const { data, arrayBuffers, transferableArrays } = serializeObject3D(mg.getMesh());

	// // Передача данных в основной поток
	// postMessage({ data, arrayBuffers }, transferableArrays);

	// // self.postMessage(serializeGeometry(geometry));

	try {
		const totalStart = performance.now();
		const extension = file.name.split('.').pop().toLowerCase();
		const factory = new LoadStrategyFactory();
		const strategy = factory.create(extension);

		const loadStart = performance.now();
		const object3D = await strategy.load(file);
		const loadMs = performance.now() - loadStart;
		if (requestId !== activeRequestId) return;

		const strategyTiming = strategy.timing || {};
		const analysisPayload = collectGeometryAnalysisPayload(object3D);
		activeAnalysisMeshes = analysisPayload.meshes;
		flushPendingSelectionDetails(requestId);
		const serializeStart = performance.now();
		const { data, transfer } = serializeThreeObject3D(object3D);
		const serializeMs = performance.now() - serializeStart;
		postMessage(
			{
				type: 'loaded',
				requestId,
				object: data,
				backgroundJobs: true,
				timing: {
					extension,
					...strategyTiming,
					loadMs,
					serializeMs,
					totalWorkerMs: performance.now() - totalStart,
					transferCount: transfer.length
				}
			},
			transfer
		);
		scheduleBackgroundAnalysis(requestId, analysisPayload.meshes, {
			extension,
			...strategyTiming,
			loadMs,
			serializeMs
		}, {
			analysisOptions: event.data?.analysisOptions || getDefaultAnalysisOptions(extension),
			includeSkeleton: true
		});
	} catch (error) {
		postMessage({
			type: 'error',
			requestId,
			message: error instanceof Error ? error.message : String(error)
		});
	}
};

function flushPendingSelectionDetails(requestId) {
	if (!pendingSelectionDetails || pendingSelectionDetails.requestId !== requestId || !activeAnalysisMeshes) {
		return;
	}

	const pending = pendingSelectionDetails;
	pendingSelectionDetails = null;
	scheduleSelectionDetails(
		pending.requestId,
		pending.selectionRequestId,
		pending.meshIds,
		pending.analysisOptions
	);
}

function scheduleBackgroundAnalysis(requestId, meshes, timing = {}, options = {}) {
	setTimeout(() => {
		if (requestId !== activeRequestId) return;

		const statsStart = performance.now();
		const stats = calculateGeometryPayloadStats(meshes, options.analysisOptions);
		const statsMs = performance.now() - statsStart;

		if (requestId !== activeRequestId) return;
		postMessage({
			type: 'stats',
			requestId,
			stats,
			timing: {
				...timing,
				statsMs
			}
		});

		setTimeout(() => {
			if (requestId !== activeRequestId) return;

			const printStart = performance.now();
			const printStats = calculatePrintVolumeEstimate(meshes, options.analysisOptions);
			const printStatsMs = performance.now() - printStart;

			if (requestId !== activeRequestId) return;
			postMessage({
				type: 'printStats',
				requestId,
				printStats,
				timing: {
					...timing,
					statsMs,
					printStatsMs
				}
			});
		}, 16);

		if (!options.includeSkeleton) return;

		setTimeout(() => {
			if (requestId !== activeRequestId) return;

			const skeletonStart = performance.now();
			const { items, transfer, topology } = buildSkeletonPayload(meshes);
			const skeletonMs = performance.now() - skeletonStart;

			if (requestId !== activeRequestId) return;
			postMessage(
				{
					type: 'skeleton',
					requestId,
					items,
					topology,
					timing: {
						...timing,
						statsMs,
						skeletonMs
					}
				},
				transfer
			);
		}, 16);
	}, 0);
}

function scheduleSelectionDetails(requestId, selectionRequestId, meshIds, analysisOptions) {
	const requestedMeshIds = Array.from(new Set((meshIds || []).filter(Boolean)));
	const requestedMeshSet = new Set(requestedMeshIds);
	const meshes = activeAnalysisMeshes.filter((mesh) => requestedMeshSet.has(mesh.id));

	setTimeout(() => {
		if (requestId !== activeRequestId) return;

		const statsStart = performance.now();
		const stats = calculateGeometryPayloadStats(meshes, analysisOptions);
		const statsMs = performance.now() - statsStart;

		if (requestId !== activeRequestId) return;
		postMessage({
			type: 'selectionStats',
			requestId,
			selectionRequestId,
			meshIds: requestedMeshIds,
			stats,
			timing: {
				statsMs
			}
		});

		setTimeout(() => {
			if (requestId !== activeRequestId) return;

			const printStart = performance.now();
			const printStats = calculatePrintVolumeEstimate(meshes, analysisOptions);
			const printStatsMs = performance.now() - printStart;

			if (requestId !== activeRequestId) return;
			postMessage({
				type: 'selectionPrintStats',
				requestId,
				selectionRequestId,
				meshIds: requestedMeshIds,
				printStats,
				timing: {
					statsMs,
					printStatsMs
				}
			});
		}, 16);
	}, 0);
}

function getDefaultAnalysisOptions(extension) {
	return {
		unitScale: 1,
		unitLabel: 'Millimeter',
		unitless: extension === 'stl'
	};
}

// Фабрика стратегий загрузки
class LoadStrategyFactory {
	create(fileExtension) {
		switch (fileExtension) {
			case 'stl':
				return new STLLoadStrategy();
			case 'obj':
				return new OBJLoadStrategy();
			case 'amf':
				return new AMFLoadStrategy();
			case '3mf':
				return new ThreeMFLoadStrategy();
			case 'ply':
				return new PLYLoadStrategy();
			case 'step':
			case 'stp':
				return new OCCTLoadStrategy('step');
			case 'iges':
			case 'igs':
				return new OCCTLoadStrategy('iges');
			case 'brep':
			case 'brp':
				return new OCCTLoadStrategy('brep');
			default:
				throw new Error(`Неподдерживаемый формат файла: ${fileExtension}`);
		}
	}
}

class BaseLoadStrategy {
	async load() {
		throw new Error('Метод load должен быть реализован');
	}
}

class STLLoadStrategy extends BaseLoadStrategy {
	async load(file) {
		return new Promise((resolve, reject) => {
			const loader = new STLLoader();
			loader.load(
				URL.createObjectURL(file),
				(geometry) => {
					// const material = new THREE.MeshStandardMaterial({ vertexColors: true});
					// const mesh = new THREE.Mesh(geometry, material);
					// resolve(mesh);

					const mg = new MeshGenerator(geometry);
					mg.update();
					resolve(mg.getMesh());
				},
				undefined,
				(error) => {
					reject(error);
				}
			);
		});
	}
}

class PLYLoadStrategy extends BaseLoadStrategy {
	async load(file) {
		return new Promise((resolve, reject) => {
			const loader = new PLYLoader();
			loader.load(
				URL.createObjectURL(file),
				(geometry) => {
					const material = new THREE.MeshStandardMaterial({ vertexColors: true });
					const mesh = new THREE.Mesh(geometry, material);
					resolve(mesh);
				},
				undefined,
				(error) => {
					reject(error);
				}
			);
		});
	}
}

class OBJLoadStrategy extends BaseLoadStrategy {
	async load(file) {
		return new Promise((resolve, reject) => {
			const loader = new OBJLoader();

			loader.load(
				URL.createObjectURL(file),
				(object) => {
					// centerObject3D(object);
					resolve(object);
				},
				undefined,
				(error) => {
					reject(error);
				}
			);
		});
	}
}

class AMFLoadStrategy extends BaseLoadStrategy {
	async load(file) {
		return new Promise((resolve, reject) => {
			const loader = new AMFLoader();

			loader.load(
				URL.createObjectURL(file),
				(object) => {
					// centerObject3D(object);
					resolve(object);
				},
				undefined,
				(error) => {
					reject(error);
				}
			);
		});
	}
}

class ThreeMFLoadStrategy extends BaseLoadStrategy {
	async load(file) {
		return new Promise((resolve, reject) => {
			const loader = new ThreeMFLoader();

			loader.load(
				URL.createObjectURL(file),
				(object) => {
					// centerObject3D(object);
					resolve(object);
				},
				undefined,
				(error) => {
					reject(error);
				}
			);
		});
	}
}

class OCCTLoadStrategy extends BaseLoadStrategy {
	constructor(format) {
		super();
		this.format = format;
		this.timing = {};
	}

	async load(file) {
		return this._loadWithParams(file, OCCT_IMPORT_PARAMS);
	}

	async _loadWithParams(file, params) {
		const timing = {};
		const importerStart = performance.now();
		const occt = await getOcctImporter();
		timing.occtInitMs = performance.now() - importerStart;

		const fileReadStart = performance.now();
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		timing.fileReadMs = performance.now() - fileReadStart;
		let result;
		const importStart = performance.now();

		if (this.format === 'step') {
			result = occt.ReadStepFile(bytes, params);
		} else if (this.format === 'iges') {
			result = occt.ReadIgesFile(bytes, params);
		} else {
			result = occt.ReadBrepFile(bytes, params);
		}
		timing.occtReadMs = performance.now() - importStart;

		if (!result.success) {
			throw new Error(`Failed to import ${this.format.toUpperCase()} file: ${file.name}`);
			throw new Error(`Не удалось импортировать STEP файл: ${file.name}`);
		}

		const buildStart = performance.now();
		const object3D = buildOcctObject3D(result, file.name);
		timing.occtBuildObjectMs = performance.now() - buildStart;
		this.timing = timing;
		return object3D;
	}
}

function getOcctImporter() {
	if (!occtImportPromise) {
		occtImportPromise = occtImportFactory({
			locateFile: (path) => (path.endsWith('.wasm') ? occtWasmUrl : path)
		});
	}

	return occtImportPromise;
}

function buildOcctObject3D(result, fallbackName) {
	const root = new THREE.Group();
	root.name = result.root?.name || fallbackName;
	const meshes = result.meshes.map(buildOcctMesh);

	if (result.root) {
		appendOcctNode(root, result.root, meshes);
	} else {
		for (const mesh of meshes) {
			root.add(mesh);
		}
	}

	return root;
}

function appendOcctNode(parent, node, meshes) {
	const group = new THREE.Group();
	group.name = node.name || '';

	for (const meshIndex of node.meshes || []) {
		const mesh = meshes[meshIndex];

		if (mesh) {
			group.add(mesh.clone());
		}
	}

	for (const child of node.children || []) {
		appendOcctNode(group, child, meshes);
	}

	parent.add(group);
}

function buildOcctMesh(meshData) {
	const geometry = new THREE.BufferGeometry();
	geometry.name = meshData.name || '';
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3)
	);

	if (meshData.attributes.normal) {
		geometry.setAttribute(
			'normal',
			new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3)
		);
	} else {
		geometry.computeVertexNormals();
	}

	geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(meshData.index.array), 1));

	const defaultMaterial = createOcctMaterial(meshData.color);
	const faceColors = meshData.brep_faces || [];
	const hasFaceColors = faceColors.some((face) => Array.isArray(face.color));
	let meshMaterial = defaultMaterial;

	if (hasFaceColors) {
		const materials = [defaultMaterial];
		const materialIndices = [];
		const materialIndexByColor = new Map();

		for (const face of faceColors) {
			if (!Array.isArray(face.color)) {
				materialIndices.push(0);
				continue;
			}

			const colorKey = face.color.map((component) => component.toFixed(6)).join(',');
			if (!materialIndexByColor.has(colorKey)) {
				materialIndexByColor.set(colorKey, materials.length);
				materials.push(createOcctMaterial(face.color));
			}

			materialIndices.push(materialIndexByColor.get(colorKey));
		}

		addOcctFaceGroups(geometry, faceColors, meshData.index.array.length / 3, materialIndices);
		meshMaterial = materials;
	}

	const mesh = new THREE.Mesh(geometry, meshMaterial);
	mesh.name = meshData.name || '';
	return mesh;
}

function createOcctMaterial(colorArray) {
	const hasColor = Array.isArray(colorArray);
	const color = hasColor
		? new THREE.Color(colorArray[0], colorArray[1], colorArray[2])
		: new THREE.Color(0xcccccc);
	const emissive = hasColor ? color.clone().multiplyScalar(0.28) : new THREE.Color(0x000000);

	return new THREE.MeshPhongMaterial({
		color,
		emissive,
		specular: 0x111111,
		shininess: 10
	});
}

function addOcctFaceGroups(geometry, faces, triangleCount, materialIndices = []) {
	let triangleIndex = 0;
	let faceIndex = 0;

	while (triangleIndex < triangleCount) {
		const firstIndex = triangleIndex;
		let lastIndex;
		let materialIndex;

		if (faceIndex >= faces.length) {
			lastIndex = triangleCount;
			materialIndex = 0;
		} else if (triangleIndex < faces[faceIndex].first) {
			lastIndex = faces[faceIndex].first;
			materialIndex = 0;
		} else {
			lastIndex = faces[faceIndex].last + 1;
			materialIndex = materialIndices[faceIndex] ?? 0;
			faceIndex += 1;
		}

		geometry.addGroup(firstIndex * 3, (lastIndex - firstIndex) * 3, materialIndex);
		triangleIndex = lastIndex;
	}
}

// function loadGeometryFromFile(file) {
//     // console.log(file)

//     return new Promise((resolve, reject) => {
//         const loader = new STLLoader(); // Создаем экземпляр STLLoader

//         // Загружаем файл по URL
//         loader.load(
//             URL.createObjectURL(file), // Создаем URL для объекта файла
//             geometry => {
//                 resolve(geometry); // Разрешаем промис с загруженной геометрией
//             },
//             undefined, // Прогресс
//             error => {
//                 reject(error); // Отклоняем промис с ошибкой
//             }
//         );
//     });
// }

// function serializeGeometry(geometry) {
//     const attributes = {};

//     // Используем Object.keys для итерации по атрибутам
//     for (const name of Object.keys(geometry.attributes)) {
//         const attribute = geometry.attributes[name];
//         attributes[name] = attribute.array; // Копируем массив данных атрибута
//     }

//     return {
//         attributes: attributes,
//         indices: geometry.index ? geometry.index.array : null,
//     };
// }

class MeshGenerator {
	setColor(value) {
		this.color = value;
		this.update();
	}

	setMatcap(value) {
		this.matcap = MeshGenerator.loadTexture(value);
		this.update();
	}
	isEnabled(value) {
		this.enabled = value;
	}
	getMesh() {
		return this.mesh;
	}

	constructor(geometry) {
		// mesh settings
		this.color = '#aaffaa';
		this.enabled = true;

		// components
		this.matcap;
		this.material;
		this.geometry = geometry;
		this.mesh;

		this.update();
	}

	// Загрузить текстуру
	static loadTexture(path) {
		return new THREE.TextureLoader().load(path);
	}

	static setCenter(
		mesh // Установить центральную точку мэша
	) {
		const boundingBox = new THREE.Box3().setFromObject(mesh);
		const center = boundingBox.getCenter(new THREE.Vector3());
		mesh.position.sub(center);
		mesh.updateMatrix();
		return mesh;
	}

	update() {
		this._calcMaterial();
		this._calcMesh();
	}

	_calcMaterial() {
		// Обсчёт материала
		this.material = new THREE.MeshMatcapMaterial({
			color: this.color,
			// visible: this.enabled,
			matcap: this.matcap || null
		});
	}

	_calcMesh() {
		// Расчёт мэша
		this.mesh = this.enabled
			? MeshGenerator.setCenter(new THREE.Mesh(this.geometry, this.material))
			: null;
	}
}

// class LinearMeshGenerator extends MeshGenerator {
//     _calcMaterial()
//     {
//         this.material = new THREE.LineDashedMaterial(
//             {
//             color: this.color,
//             linewidth: 5,
//             scale: 2,
//             dashSize: 3,
//             gapSize: 1,
//             // visible: this.enabled
//             }
//         );
//     }

//     _calcMesh()
//     {
//         this.mesh = this.enabled ? MeshGenerator.setCenter(
//             new THREE.LineSegments(
//                 new THREE.EdgesGeometry(this.geometry), this.material)) : null;
//     }
// }

// Функция для сериализации Object3D
// function serializeObject3D(object) {
//     console.log(object);
//     // Сериализованные данные
//     const data = {
//         type: object.type, // 'Mesh', 'LineSegments' и т.д.
//         geometry: {},
//         material: {},
//         matrix: object.matrix.toArray(),
//         userData: object.userData
//     };

//     // Сериализация геометрии
//     const geometry = object.geometry;
//     const geometryData = data.geometry;

//     // Сериализуем атрибуты геометрии
//     geometryData.attributes = {};
//     const attributes = geometry.attributes;

//     const transferableArrays = [];
//     const arrayBuffers = []; // Хранение массивов для передачи

//     for (const name in attributes) {
//         const attribute = attributes[name];
//         const array = attribute.array;

//         // Сохраняем информацию об атрибуте
//         geometryData.attributes[name] = {
//             itemSize: attribute.itemSize,
//             count: attribute.count,
//             normalized: attribute.normalized,
//             arrayType: array.constructor.name,
//             // Добавляем идентификатор для связи с массивом
//             bufferIndex: arrayBuffers.length
//         };

//         // Сохраняем массив
//         arrayBuffers.push(array);
//         // Добавляем buffer в список для передачи
//         transferableArrays.push(array.buffer);
//     }

//     // Сериализация индексов (если есть)
//     if (geometry.index) {
//         const index = geometry.index;
//         const array = index.array;

//         geometryData.index = {
//             itemSize: index.itemSize,
//             count: index.count,
//             normalized: index.normalized,
//             arrayType: array.constructor.name,
//             bufferIndex: arrayBuffers.length
//         };

//         arrayBuffers.push(array);
//         transferableArrays.push(array.buffer);
//     }

//     // Сериализация материала (упрощенно)
//     const material = object.material;
//     data.material = {
//         type: material.type,
//         color: material.color ? material.color.getHex() : null,
//         linewidth: material.linewidth || null
//     };

//     return { data, arrayBuffers, transferableArrays };
// }

// eslint-disable-next-line no-unused-vars
function serializeObject3D(object) {
	const data = {
		uuid: object.uuid,
		type: object.type,
		name: object.name,
		matrix: object.matrix.toArray(),
		userData: object.userData,
		children: []
	};

	const transferableObjects = [];

	if (object.isMesh || object.isLine || object.isPoints) {
		// Сериализуем геометрию
		data.geometry = serializeGeometry(object.geometry, transferableObjects);
		// Сериализуем материал
		console.log('typeof', typeof object.material);

		// data.material = serializeMaterial(object.material);

		if (Array.isArray(object.material)) {
			data.material = object.material.map((m) => serializeMaterial(m, transferableObjects));
		} else {
			data.material = serializeMaterial(object.material);
		}
	}

	console.log('DATA loader', data);
	// Рекурсивная сериализация дочерних объектов
	for (const child of object.children) {
		const serializedChild = serializeObject3D(child);
		data.children.push(serializedChild.data);
		transferableObjects.push(...serializedChild.transferableObjects);
	}

	return { data, transferableObjects };
}

function serializeGeometry(geometry, transferableObjects) {
	const data = {
		type: geometry.type,
		uuid: geometry.uuid,
		attributes: {},
		index: null
	};

	// Сериализуем атрибуты
	for (const name in geometry.attributes) {
		const attribute = geometry.attributes[name];
		const array = attribute.array;
		data.attributes[name] = {
			itemSize: attribute.itemSize,
			count: attribute.count,
			normalized: attribute.normalized,
			arrayType: array.constructor.name,
			buffer: array.buffer
		};
		transferableObjects.push(array.buffer);
	}

	// Сериализуем индексы
	if (geometry.index) {
		const index = geometry.index;
		const array = index.array;
		data.index = {
			itemSize: index.itemSize,
			count: index.count,
			normalized: index.normalized,
			arrayType: array.constructor.name,
			buffer: array.buffer
		};
		transferableObjects.push(array.buffer);
	}

	return data;
}

function serializeMaterial(material, transferableObjects) {
	console.log('loader:', material);
	const data = {
		type: material.type,
		uuid: material.uuid,
		name: material.name,
		color: material.color ? material.color.getHex() : null,
		emissive: material.emissive ? material.emissive.getHex() : null,
		roughness: material.roughness !== undefined ? material.roughness : null,
		metalness: material.metalness !== undefined ? material.metalness : null,
		opacity: material.opacity,
		transparent: material.transparent,
		side: material.side,
		depthTest: material.depthTest,
		depthWrite: material.depthWrite,
		wireframe: material.wireframe,
		map: material.map ? serializeTexture(material.map, transferableObjects) : null,
		normalMap: material.normalMap
			? serializeTexture(material.normalMap, transferableObjects)
			: null,
		roughnessMap: material.roughnessMap
			? serializeTexture(material.roughnessMap, transferableObjects)
			: null,
		metalnessMap: material.metalnessMap
			? serializeTexture(material.metalnessMap, transferableObjects)
			: null,
		emissiveMap: material.emissiveMap
			? serializeTexture(material.emissiveMap, transferableObjects)
			: null,
		alphaMap: material.alphaMap ? serializeTexture(material.alphaMap, transferableObjects) : null
		// Добавьте другие свойства материала при необходимости
	};
	return data;
}

function serializeTexture(texture, transferableObjects) {
	console.log('texture loader:', typeof texture);
	const image = texture.image;
	let imageData = null;

	if (image && image.data) {
		// Если текстура создана из данных (например, процедурная текстура)
		imageData = {
			width: image.width,
			height: image.height,
			data: image.data.buffer,
			dataType: image.data.constructor.name
		};
		transferableObjects.push(image.data.buffer);
	} else if (image && image.src) {
		// Если текстура загружена из изображения
		imageData = {
			src: image.src
		};
	}

	const data = {
		uuid: texture.uuid,
		name: texture.name,
		image: imageData,
		wrapS: texture.wrapS !== undefined ? texture.wrapS : THREE.ClampToEdgeWrapping,
		wrapT: texture.wrapT !== undefined ? texture.wrapT : THREE.ClampToEdgeWrapping,
		repeat: texture.repeat ? texture.repeat.toArray() : [1, 1],
		offset: texture.offset ? texture.offset.toArray() : [0, 0],
		rotation: texture.rotation !== undefined ? texture.rotation : 0
		// Добавьте другие свойства текстуры при необходимости
	};

	return data;
}
