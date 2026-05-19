import * as THREE from 'three';

const vertexA = new THREE.Vector3();
const vertexB = new THREE.Vector3();
const vertexC = new THREE.Vector3();
const edgeAB = new THREE.Vector3();
const edgeAC = new THREE.Vector3();
const cross = new THREE.Vector3();

export function calculateModelStats(object3D, options = {}) {
	const includeVolume = options.includeVolume !== false;
	const bounds = new THREE.Box3();
	const size = new THREE.Vector3();
	const meshes = [];
	let volume = includeVolume ? 0 : null;
	let surfaceArea = includeVolume ? 0 : null;
	let vertices = 0;
	let triangles = 0;

	object3D.updateMatrixWorld(true);
	bounds.setFromObject(object3D);
	object3D.traverse((object) => {
		if (!object.isMesh || !object.geometry) return;

		const geometryStats = calculateGeometryStats(
			object.geometry,
			object.matrixWorld,
			includeVolume
		);
		if (includeVolume) {
			volume += Math.abs(geometryStats.volume);
			surfaceArea += geometryStats.surfaceArea;
		}
		vertices += geometryStats.vertices;
		triangles += geometryStats.triangles;
		meshes.push({
			name: object.name || object.geometry.name || 'No Name',
			visible: object.visible !== false,
			vertices: geometryStats.vertices,
			triangles: geometryStats.triangles
		});
	});

	if (!bounds.isEmpty()) {
		bounds.getSize(size);
	}

	return {
		vertices,
		triangles,
		meshes,
		size: {
			x: size.x,
			y: size.y,
			z: size.z
		},
		volume,
		volumeMm3: volume,
		volumeCm3: includeVolume ? volume / 1000 : null,
		surfaceArea,
		surfaceAreaMm2: surfaceArea,
		surfaceAreaCm2: includeVolume ? surfaceArea / 100 : null
	};
}

export function calculateModelVolume(object3D) {
	return calculateModelStats(object3D).volume;
}

function calculateGeometryStats(geometry, matrixWorld, includeVolume) {
	const position = geometry.getAttribute('position');
	if (!position) {
		return { volume: 0, surfaceArea: 0, vertices: 0, triangles: 0 };
	}

	const index = geometry.getIndex();
	const triangles = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
	let volume = 0;
	let surfaceArea = 0;

	if (!includeVolume) {
		return {
			volume,
			surfaceArea,
			vertices: position.count,
			triangles
		};
	}

	if (index) {
		for (let i = 0; i < index.count; i += 3) {
			readTriangle(position, index.getX(i), index.getX(i + 1), index.getX(i + 2), matrixWorld);
			volume += calculateTriangleVolume(vertexA, vertexB, vertexC);
			surfaceArea += calculateTriangleArea(vertexA, vertexB, vertexC);
		}
	} else {
		for (let i = 0; i < position.count; i += 3) {
			readTriangle(position, i, i + 1, i + 2, matrixWorld);
			volume += calculateTriangleVolume(vertexA, vertexB, vertexC);
			surfaceArea += calculateTriangleArea(vertexA, vertexB, vertexC);
		}
	}

	return {
		volume,
		surfaceArea,
		vertices: position.count,
		triangles
	};
}

function readTriangle(position, indexA, indexB, indexC, matrixWorld) {
	readVertex(position, indexA, matrixWorld, vertexA);
	readVertex(position, indexB, matrixWorld, vertexB);
	readVertex(position, indexC, matrixWorld, vertexC);
}

function readVertex(position, index, matrixWorld, target) {
	return target.fromBufferAttribute(position, index).applyMatrix4(matrixWorld);
}

function calculateTriangleVolume(a, b, c) {
	return a.dot(cross.crossVectors(b, c)) / 6;
}

function calculateTriangleArea(a, b, c) {
	edgeAB.subVectors(b, a);
	edgeAC.subVectors(c, a);
	return cross.crossVectors(edgeAB, edgeAC).length() / 2;
}
