import * as THREE from 'three';

const vertexA = new THREE.Vector3();
const vertexB = new THREE.Vector3();
const vertexC = new THREE.Vector3();
const edgeAB = new THREE.Vector3();
const edgeAC = new THREE.Vector3();
const cross = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const bounds = new THREE.Box3();
const size = new THREE.Vector3();
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();
const localC = new THREE.Vector3();
const skeletonNormal = new THREE.Vector3();
const printA = new THREE.Vector3();
const printB = new THREE.Vector3();
const printC = new THREE.Vector3();

const SKELETON_VERTEX_TOLERANCE = 1e-4;
const SKELETON_ANGLE_DEGREES = 35;
const DEFAULT_PRINT_LAYER_HEIGHT_MM = 0.2;
const DEFAULT_PRINT_MAX_LAYERS = 180;
const DEFAULT_PRINT_SCANLINES = 72;

export function collectGeometryAnalysisPayload(object3D) {
	const meshes = [];
	const transfer = [];

	object3D.updateMatrixWorld(true);
	object3D.traverse((object) => {
		if (!object.isMesh || !object.geometry) return;

		const position = object.geometry.getAttribute('position');
		if (!position) return;

		const index = object.geometry.getIndex();
		const positionArray = cloneAttributeArray(position);
		const indexArray = index ? cloneAttributeArray(index) : null;

		transfer.push(positionArray.buffer);
		if (indexArray) transfer.push(indexArray.buffer);

		meshes.push({
			id: object.uuid,
			name: object.name || object.geometry.name || 'No Name',
			visible: object.visible !== false,
			position: positionArray,
			positionItemSize: position.itemSize,
			index: indexArray,
			indexItemSize: index?.itemSize || 1,
			matrixWorld: object.matrixWorld.toArray()
		});
	});

	return { meshes, transfer };
}

export function calculateGeometryPayloadStats(meshes, options = {}) {
	const unitScale = Number.isFinite(options.unitScale) && options.unitScale > 0 ? options.unitScale : 1;
	bounds.makeEmpty();

	let volume = 0;
	let surfaceArea = 0;
	let vertices = 0;
	let triangles = 0;
	const meshStats = [];

	for (const mesh of meshes) {
		const stats = calculateMeshStats(mesh, unitScale);

		volume += Math.abs(stats.volume);
		surfaceArea += stats.surfaceArea;
		vertices += stats.vertices;
		triangles += stats.triangles;
		meshStats.push({
			name: mesh.name,
			visible: mesh.visible,
			vertices: stats.vertices,
			triangles: stats.triangles
		});
	}

	if (!bounds.isEmpty()) {
		bounds.getSize(size);
	} else {
		size.set(0, 0, 0);
	}

	return {
		vertices,
		triangles,
		meshes: meshStats,
		size: {
			x: size.x,
			y: size.y,
			z: size.z
		},
		volume,
		volumeMm3: volume,
		volumeCm3: volume / 1000,
		surfaceArea,
		surfaceAreaMm2: surfaceArea,
		surfaceAreaCm2: surfaceArea / 100,
		unitScale,
		unitLabel: options.unitLabel || 'Millimeter',
		unitless: Boolean(options.unitless),
		unitWarning: options.unitless
			? 'STL does not store units. Volume and size depend on the selected unit scale.'
			: ''
	};
}

function calculateMeshStats(mesh, unitScale = 1) {
	const positions = mesh.position;
	const itemSize = mesh.positionItemSize;
	const indices = mesh.index;
	const vertexCount = Math.floor(positions.length / itemSize);
	const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(vertexCount / 3);

	let volume = 0;
	let surfaceArea = 0;
	matrix.fromArray(mesh.matrixWorld);

	if (indices) {
		for (let i = 0; i < indices.length; i += 3) {
			readTriangle(positions, itemSize, indices[i], indices[i + 1], indices[i + 2], matrix);
			scaleTriangle(unitScale);
			volume += calculateTriangleVolume(vertexA, vertexB, vertexC);
			surfaceArea += calculateTriangleArea(vertexA, vertexB, vertexC);
			expandBounds(vertexA, vertexB, vertexC);
		}
	} else {
		for (let i = 0; i < vertexCount; i += 3) {
			readTriangle(positions, itemSize, i, i + 1, i + 2, matrix);
			scaleTriangle(unitScale);
			volume += calculateTriangleVolume(vertexA, vertexB, vertexC);
			surfaceArea += calculateTriangleArea(vertexA, vertexB, vertexC);
			expandBounds(vertexA, vertexB, vertexC);
		}
	}

	return {
		volume,
		surfaceArea,
		vertices: vertexCount,
		triangles: triangleCount
	};
}

export function buildSkeletonPayload(
	meshes,
	angleDegrees = SKELETON_ANGLE_DEGREES,
	tolerance = SKELETON_VERTEX_TOLERANCE
) {
	const items = [];
	const transfer = [];
	const topology = createTopologySummary();
	const cosThreshold = Math.cos(THREE.MathUtils.degToRad(angleDegrees));
	const quantizeScale = 1 / tolerance;

	for (const mesh of meshes) {
		const result = buildMeshSkeletonEdges(mesh, cosThreshold, quantizeScale);
		const linePositions = result.linePositions;
		mergeTopologySummary(topology, result.topology);

		if (linePositions.length === 0) continue;

		items.push({
			id: mesh.id,
			name: mesh.name,
			linePositions
		});
		transfer.push(linePositions.buffer);
	}

	topology.watertight = topology.boundaryEdges === 0 && topology.nonManifoldEdges === 0;
	return { items, transfer, topology };
}

export function calculatePrintVolumeEstimate(meshes, options = {}) {
	const unitScale = Number.isFinite(options.unitScale) && options.unitScale > 0 ? options.unitScale : 1;
	const layerHeightTarget =
		Number.isFinite(options.printLayerHeightMm) && options.printLayerHeightMm > 0
			? options.printLayerHeightMm
			: DEFAULT_PRINT_LAYER_HEIGHT_MM;
	const maxLayers =
		Number.isFinite(options.printMaxLayers) && options.printMaxLayers > 0
			? Math.floor(options.printMaxLayers)
			: DEFAULT_PRINT_MAX_LAYERS;
	const scanlines =
		Number.isFinite(options.printScanlines) && options.printScanlines > 0
			? Math.floor(options.printScanlines)
			: DEFAULT_PRINT_SCANLINES;

	const printBounds = calculatePayloadBounds(meshes, unitScale);
	const sizeZ = printBounds.maxZ - printBounds.minZ;

	if (!Number.isFinite(sizeZ) || sizeZ <= 0) {
		return createEmptyPrintEstimate(options);
	}

	const layerCount = Math.max(1, Math.min(maxLayers, Math.ceil(sizeZ / layerHeightTarget)));
	const layerHeight = sizeZ / layerCount;
	const bins = Array.from({ length: layerCount }, () => []);
	let candidateTriangleRefs = 0;

	for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
		const mesh = meshes[meshIndex];
		const triangleCount = getTriangleCount(mesh);
		matrix.fromArray(mesh.matrixWorld);

		for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
			readMeshTriangle(mesh, triangleIndex, matrix, printA, printB, printC);
			scalePrintTriangle(unitScale);

			const zMin = Math.min(printA.z, printB.z, printC.z);
			const zMax = Math.max(printA.z, printB.z, printC.z);
			if (zMax - zMin <= 1e-12) continue;

			const startLayer = clampLayerIndex(
				Math.ceil((zMin - printBounds.minZ) / layerHeight - 0.5),
				layerCount
			);
			const endLayer = clampLayerIndex(
				Math.floor((zMax - printBounds.minZ) / layerHeight - 0.5),
				layerCount
			);

			for (let layerIndex = startLayer; layerIndex <= endLayer; layerIndex += 1) {
				bins[layerIndex].push(meshIndex, triangleIndex);
				candidateTriangleRefs += 1;
			}
		}
	}

	let volumeMm3 = 0;
	let surfaceLayers = 0;
	let emptyLayers = 0;
	let totalSegments = 0;
	let repairedScanlines = 0;

	for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
		const z = printBounds.minZ + (layerIndex + 0.5) * layerHeight;
		const segments = [];
		let minY = Infinity;
		let maxY = -Infinity;
		const bin = bins[layerIndex];

		for (let index = 0; index < bin.length; index += 2) {
			const mesh = meshes[bin[index]];
			const triangleIndex = bin[index + 1];
			matrix.fromArray(mesh.matrixWorld);
			readMeshTriangle(mesh, triangleIndex, matrix, printA, printB, printC);
			scalePrintTriangle(unitScale);

			const segment = intersectTriangleAtZ(printA, printB, printC, z);
			if (!segment) continue;

			segments.push(segment.x1, segment.y1, segment.x2, segment.y2);
			minY = Math.min(minY, segment.y1, segment.y2);
			maxY = Math.max(maxY, segment.y1, segment.y2);
		}

		totalSegments += segments.length / 4;

		if (segments.length === 0 || maxY <= minY) {
			emptyLayers += 1;
			continue;
		}

		const areaResult = estimateLayerAreaByScanlines(segments, minY, maxY, scanlines);
		volumeMm3 += areaResult.area * layerHeight;
		repairedScanlines += areaResult.repairedScanlines;
		if (areaResult.area > 0) surfaceLayers += 1;
	}

	return {
		printVolumeMm3: volumeMm3,
		printVolumeCm3: volumeMm3 / 1000,
		printLayerHeightMm: layerHeight,
		printLayerCount: layerCount,
		printScanlines: scanlines,
		printSegments: totalSegments,
		printCandidateTriangleRefs: candidateTriangleRefs,
		printEmptyLayers: emptyLayers,
		printSurfaceLayers: surfaceLayers,
		printRepairedScanlines: repairedScanlines,
		printMethod: 'sliced-parity-scanlines',
		printEstimateWarning:
			'Estimated from sliced contours. Open contours are paired by scanline parity, similar to slicer-style repair.'
	};
}

function createEmptyPrintEstimate(options = {}) {
	return {
		printVolumeMm3: 0,
		printVolumeCm3: 0,
		printLayerHeightMm: options.printLayerHeightMm || DEFAULT_PRINT_LAYER_HEIGHT_MM,
		printLayerCount: 0,
		printScanlines: 0,
		printSegments: 0,
		printCandidateTriangleRefs: 0,
		printEmptyLayers: 0,
		printSurfaceLayers: 0,
		printRepairedScanlines: 0,
		printMethod: 'sliced-parity-scanlines',
		printEstimateWarning: 'Unable to estimate print volume: model has no measurable Z height.'
	};
}

function calculatePayloadBounds(meshes, unitScale) {
	const result = {
		minX: Infinity,
		minY: Infinity,
		minZ: Infinity,
		maxX: -Infinity,
		maxY: -Infinity,
		maxZ: -Infinity
	};

	for (const mesh of meshes) {
		const triangleCount = getTriangleCount(mesh);
		matrix.fromArray(mesh.matrixWorld);

		for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
			readMeshTriangle(mesh, triangleIndex, matrix, printA, printB, printC);
			scalePrintTriangle(unitScale);
			expandPlainBounds(result, printA, printB, printC);
		}
	}

	return result;
}

function getTriangleCount(mesh) {
	if (mesh.index) return Math.floor(mesh.index.length / 3);
	return Math.floor(mesh.position.length / mesh.positionItemSize / 3);
}

function readMeshTriangle(mesh, triangleIndex, transform, a, b, c) {
	const indices = mesh.index;
	const itemSize = mesh.positionItemSize;

	if (indices) {
		const offset = triangleIndex * 3;
		readVertex(mesh.position, itemSize, indices[offset], transform, a);
		readVertex(mesh.position, itemSize, indices[offset + 1], transform, b);
		readVertex(mesh.position, itemSize, indices[offset + 2], transform, c);
		return;
	}

	const vertexIndex = triangleIndex * 3;
	readVertex(mesh.position, itemSize, vertexIndex, transform, a);
	readVertex(mesh.position, itemSize, vertexIndex + 1, transform, b);
	readVertex(mesh.position, itemSize, vertexIndex + 2, transform, c);
}

function scalePrintTriangle(unitScale) {
	if (unitScale === 1) return;
	printA.multiplyScalar(unitScale);
	printB.multiplyScalar(unitScale);
	printC.multiplyScalar(unitScale);
}

function expandPlainBounds(target, a, b, c) {
	target.minX = Math.min(target.minX, a.x, b.x, c.x);
	target.minY = Math.min(target.minY, a.y, b.y, c.y);
	target.minZ = Math.min(target.minZ, a.z, b.z, c.z);
	target.maxX = Math.max(target.maxX, a.x, b.x, c.x);
	target.maxY = Math.max(target.maxY, a.y, b.y, c.y);
	target.maxZ = Math.max(target.maxZ, a.z, b.z, c.z);
}

function clampLayerIndex(index, layerCount) {
	return Math.max(0, Math.min(layerCount - 1, index));
}

function intersectTriangleAtZ(a, b, c, z) {
	const points = [];
	addZIntersection(points, a, b, z);
	addZIntersection(points, b, c, z);
	addZIntersection(points, c, a, z);

	if (points.length < 4) return null;

	return {
		x1: points[0],
		y1: points[1],
		x2: points[2],
		y2: points[3]
	};
}

function addZIntersection(points, a, b, z) {
	if (points.length >= 4) return;

	const da = a.z - z;
	const db = b.z - z;
	const epsilon = 1e-9;

	if (Math.abs(da) <= epsilon && Math.abs(db) <= epsilon) return;
	if (da * db > 0) return;
	if (Math.abs(da - db) <= epsilon) return;

	const t = da / (da - db);
	if (t < -epsilon || t > 1 + epsilon) return;

	const x = a.x + (b.x - a.x) * t;
	const y = a.y + (b.y - a.y) * t;

	for (let index = 0; index < points.length; index += 2) {
		if (Math.abs(points[index] - x) <= epsilon && Math.abs(points[index + 1] - y) <= epsilon) {
			return;
		}
	}

	points.push(x, y);
}

function estimateLayerAreaByScanlines(segments, minY, maxY, scanlineCount) {
	const height = maxY - minY;
	if (height <= 0) return { area: 0, repairedScanlines: 0 };

	const rows = Math.max(8, scanlineCount);
	const dy = height / rows;
	const xs = [];
	let area = 0;
	let repairedScanlines = 0;

	for (let row = 0; row < rows; row += 1) {
		const y = minY + (row + 0.5) * dy;
		xs.length = 0;

		for (let index = 0; index < segments.length; index += 4) {
			const x1 = segments[index];
			const y1 = segments[index + 1];
			const x2 = segments[index + 2];
			const y2 = segments[index + 3];

			if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
				const t = (y - y1) / (y2 - y1);
				xs.push(x1 + (x2 - x1) * t);
			}
		}

		if (xs.length < 2) continue;
		xs.sort((a, b) => a - b);
		if (xs.length % 2 !== 0) repairedScanlines += 1;

		for (let index = 0; index + 1 < xs.length; index += 2) {
			const covered = xs[index + 1] - xs[index];
			if (covered > 0) area += covered * dy;
		}
	}

	return { area, repairedScanlines };
}

function buildMeshSkeletonEdges(mesh, cosThreshold, quantizeScale) {
	const positions = mesh.position;
	const itemSize = mesh.positionItemSize;
	const indices = mesh.index;
	const vertexCount = Math.floor(positions.length / itemSize);
	const edges = new Map();

	if (indices) {
		for (let i = 0; i < indices.length; i += 3) {
			collectTriangleEdges(mesh, indices[i], indices[i + 1], indices[i + 2], edges, quantizeScale);
		}
	} else {
		for (let i = 0; i < vertexCount; i += 3) {
			collectTriangleEdges(mesh, i, i + 1, i + 2, edges, quantizeScale);
		}
	}

	const output = [];
	const topology = createTopologySummary();

	for (const edge of edges.values()) {
		const normalCount = edge.normals.length / 3;
		topology.edges += 1;
		if (normalCount === 1) topology.boundaryEdges += 1;
		if (normalCount > 2) topology.nonManifoldEdges += 1;

		if (isSkeletonEdge(edge, cosThreshold)) {
			topology.featureEdges += 1;
			output.push(
				edge.ax,
				edge.ay,
				edge.az,
				edge.bx,
				edge.by,
				edge.bz
			);
		}
	}

	topology.watertight = topology.boundaryEdges === 0 && topology.nonManifoldEdges === 0;
	return {
		linePositions: new Float32Array(output),
		topology
	};
}

function createTopologySummary() {
	return {
		edges: 0,
		boundaryEdges: 0,
		nonManifoldEdges: 0,
		featureEdges: 0,
		watertight: null
	};
}

function mergeTopologySummary(target, source) {
	target.edges += source.edges;
	target.boundaryEdges += source.boundaryEdges;
	target.nonManifoldEdges += source.nonManifoldEdges;
	target.featureEdges += source.featureEdges;
}

function collectTriangleEdges(mesh, indexA, indexB, indexC, edges, quantizeScale) {
	readLocalTriangle(mesh.position, mesh.positionItemSize, indexA, indexB, indexC);

	edgeAB.subVectors(localB, localA);
	edgeAC.subVectors(localC, localA);
	skeletonNormal.crossVectors(edgeAB, edgeAC);

	const normalLengthSq = skeletonNormal.lengthSq();
	if (normalLengthSq <= 1e-20) return;

	skeletonNormal.multiplyScalar(1 / Math.sqrt(normalLengthSq));

	addSkeletonEdge(edges, localA, localB, skeletonNormal, quantizeScale);
	addSkeletonEdge(edges, localB, localC, skeletonNormal, quantizeScale);
	addSkeletonEdge(edges, localC, localA, skeletonNormal, quantizeScale);
}

function addSkeletonEdge(edges, a, b, normal, quantizeScale) {
	const keyA = vertexKey(a, quantizeScale);
	const keyB = vertexKey(b, quantizeScale);
	const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
	let edge = edges.get(key);

	if (!edge) {
		edge = {
			ax: a.x,
			ay: a.y,
			az: a.z,
			bx: b.x,
			by: b.y,
			bz: b.z,
			normals: []
		};
		edges.set(key, edge);
	}

	edge.normals.push(normal.x, normal.y, normal.z);
}

function isSkeletonEdge(edge, cosThreshold) {
	const normalCount = edge.normals.length / 3;

	if (normalCount !== 2) return true;

	const dot =
		edge.normals[0] * edge.normals[3] +
		edge.normals[1] * edge.normals[4] +
		edge.normals[2] * edge.normals[5];

	return dot <= cosThreshold;
}

function vertexKey(vertex, quantizeScale) {
	return `${Math.round(vertex.x * quantizeScale)},${Math.round(vertex.y * quantizeScale)},${Math.round(vertex.z * quantizeScale)}`;
}

function readLocalTriangle(positions, itemSize, indexA, indexB, indexC) {
	readLocalVertex(positions, itemSize, indexA, localA);
	readLocalVertex(positions, itemSize, indexB, localB);
	readLocalVertex(positions, itemSize, indexC, localC);
}

function readLocalVertex(positions, itemSize, index, target) {
	const offset = index * itemSize;
	target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
	return target;
}

function cloneAttributeArray(attribute) {
	if (attribute.isInterleavedBufferAttribute) {
		const source = attribute.data.array;
		const ArrayConstructor = source.constructor;
		const array = new ArrayConstructor(attribute.count * attribute.itemSize);

		for (let index = 0; index < attribute.count; index += 1) {
			array[index * attribute.itemSize] = attribute.getX(index);
			if (attribute.itemSize > 1) array[index * attribute.itemSize + 1] = attribute.getY(index);
			if (attribute.itemSize > 2) array[index * attribute.itemSize + 2] = attribute.getZ(index);
			if (attribute.itemSize > 3) array[index * attribute.itemSize + 3] = attribute.getW(index);
		}

		return array;
	}

	return attribute.array.slice();
}

function readTriangle(positions, itemSize, indexA, indexB, indexC, transform) {
	readVertex(positions, itemSize, indexA, transform, vertexA);
	readVertex(positions, itemSize, indexB, transform, vertexB);
	readVertex(positions, itemSize, indexC, transform, vertexC);
}

function readVertex(positions, itemSize, index, transform, target) {
	const offset = index * itemSize;
	target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
	return target.applyMatrix4(transform);
}

function scaleTriangle(unitScale) {
	if (unitScale === 1) return;
	vertexA.multiplyScalar(unitScale);
	vertexB.multiplyScalar(unitScale);
	vertexC.multiplyScalar(unitScale);
}

function expandBounds(a, b, c) {
	bounds.expandByPoint(a);
	bounds.expandByPoint(b);
	bounds.expandByPoint(c);
}

function calculateTriangleVolume(a, b, c) {
	return a.dot(cross.crossVectors(b, c)) / 6;
}

function calculateTriangleArea(a, b, c) {
	edgeAB.subVectors(b, a);
	edgeAC.subVectors(c, a);
	return cross.crossVectors(edgeAB, edgeAC).length() / 2;
}
