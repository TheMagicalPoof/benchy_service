import * as THREE from 'three';

const MATERIAL_MAPS = [
	'map',
	'matcap',
	'normalMap',
	'roughnessMap',
	'metalnessMap',
	'emissiveMap',
	'alphaMap',
	'bumpMap',
	'displacementMap',
	'aoMap'
];

const MATERIAL_FIELDS = [
	'opacity',
	'transparent',
	'side',
	'depthTest',
	'depthWrite',
	'wireframe',
	'vertexColors',
	'flatShading',
	'roughness',
	'metalness',
	'linewidth',
	'size',
	'sizeAttenuation'
];

const TEXTURE_FIELDS = [
	'wrapS',
	'wrapT',
	'magFilter',
	'minFilter',
	'anisotropy',
	'format',
	'type',
	'flipY',
	'premultiplyAlpha',
	'unpackAlignment',
	'colorSpace',
	'rotation'
];

const TYPED_ARRAYS = {
	Float32Array,
	Float64Array,
	Int8Array,
	Uint8Array,
	Uint8ClampedArray,
	Int16Array,
	Uint16Array,
	Int32Array,
	Uint32Array
};

export function serializeObject3D(object) {
	const context = {
		transfer: [],
		seenBuffers: new Set()
	};

	return {
		data: serializeNode(object, context),
		transfer: context.transfer
	};
}

export function deserializeObject3D(data) {
	const object = createObject(data.type);

	object.uuid = data.uuid || object.uuid;
	object.name = data.name || '';
	object.visible = data.visible !== false;
	object.castShadow = Boolean(data.castShadow);
	object.receiveShadow = Boolean(data.receiveShadow);
	object.frustumCulled = data.frustumCulled !== false;
	object.userData = data.userData || {};

	if (Array.isArray(data.matrix)) {
		object.matrix.fromArray(data.matrix);
		object.matrix.decompose(object.position, object.quaternion, object.scale);
	}

	if (data.geometry) {
		object.geometry = deserializeGeometry(data.geometry);
	}

	if (Array.isArray(data.material)) {
		object.material = data.material.map(deserializeMaterial);
	} else if (data.material) {
		object.material = deserializeMaterial(data.material);
	}

	for (const childData of data.children || []) {
		object.add(deserializeObject3D(childData));
	}

	return object;
}

function serializeNode(object, context) {
	object.updateMatrix();

	const data = {
		uuid: object.uuid,
		type: object.type,
		name: object.name,
		visible: object.visible,
		castShadow: object.castShadow,
		receiveShadow: object.receiveShadow,
		frustumCulled: object.frustumCulled,
		matrix: object.matrix.toArray(),
		userData: cloneUserData(object.userData),
		children: []
	};

	if (object.geometry) {
		data.geometry = serializeGeometry(object.geometry, context);
	}

	if (Array.isArray(object.material)) {
		data.material = object.material.map((material) => serializeMaterial(material, context));
	} else if (object.material) {
		data.material = serializeMaterial(object.material, context);
	}

	for (const child of object.children || []) {
		data.children.push(serializeNode(child, context));
	}

	return data;
}

function createObject(type) {
	switch (type) {
		case 'Mesh':
			return new THREE.Mesh();
		case 'Line':
			return new THREE.Line();
		case 'LineSegments':
			return new THREE.LineSegments();
		case 'Points':
			return new THREE.Points();
		case 'Group':
			return new THREE.Group();
		default:
			return new THREE.Object3D();
	}
}

function serializeGeometry(geometry, context) {
	const data = {
		type: geometry.type,
		uuid: geometry.uuid,
		name: geometry.name,
		attributes: {},
		index: geometry.index ? serializeAttribute(geometry.index, context) : null,
		groups: geometry.groups.map((group) => ({ ...group })),
		drawRange: { ...geometry.drawRange }
	};

	for (const [name, attribute] of Object.entries(geometry.attributes)) {
		data.attributes[name] = serializeAttribute(attribute, context);
	}

	return data;
}

function deserializeGeometry(data) {
	const geometry = new THREE.BufferGeometry();

	geometry.uuid = data.uuid || geometry.uuid;
	geometry.name = data.name || '';

	for (const [name, attributeData] of Object.entries(data.attributes || {})) {
		geometry.setAttribute(name, deserializeAttribute(attributeData));
	}

	if (data.index) {
		geometry.setIndex(deserializeAttribute(data.index));
	}

	for (const group of data.groups || []) {
		geometry.addGroup(group.start, group.count, group.materialIndex);
	}

	if (data.drawRange) {
		geometry.setDrawRange(data.drawRange.start, data.drawRange.count);
	}

	return geometry;
}

function serializeAttribute(attribute, context) {
	const normalized = Boolean(attribute.normalized);
	const itemSize = attribute.itemSize;
	const array = attribute.isInterleavedBufferAttribute
		? deinterleaveAttribute(attribute)
		: attribute.array;

	addTransfer(array.buffer, context);

	return {
		itemSize,
		count: attribute.count,
		normalized,
		arrayType: array.constructor.name,
		buffer: array.buffer,
		byteOffset: array.byteOffset,
		length: array.length
	};
}

function deserializeAttribute(data) {
	const ArrayConstructor = getTypedArrayConstructor(data.arrayType);
	const array = new ArrayConstructor(data.buffer, data.byteOffset || 0, data.length);

	return new THREE.BufferAttribute(array, data.itemSize, Boolean(data.normalized));
}

function deinterleaveAttribute(attribute) {
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

function serializeMaterial(material, context) {
	const data = {
		type: material.type,
		uuid: material.uuid,
		name: material.name,
		userData: cloneUserData(material.userData)
	};

	if (material.color) data.color = material.color.getHex();
	if (material.emissive) data.emissive = material.emissive.getHex();
	if (material.specular) data.specular = material.specular.getHex();

	for (const field of MATERIAL_FIELDS) {
		if (material[field] !== undefined) {
			data[field] = material[field];
		}
	}

	for (const mapName of MATERIAL_MAPS) {
		if (material[mapName]) {
			data[mapName] = serializeTexture(material[mapName], context);
		}
	}

	return data;
}

function deserializeMaterial(data) {
	const material = createMaterial(data.type);

	material.uuid = data.uuid || material.uuid;
	material.name = data.name || '';
	material.userData = data.userData || {};

	if (data.color !== undefined && material.color) material.color.setHex(data.color);
	if (data.emissive !== undefined && material.emissive) material.emissive.setHex(data.emissive);
	if (data.specular !== undefined && material.specular) material.specular.setHex(data.specular);

	for (const field of MATERIAL_FIELDS) {
		if (data[field] !== undefined && field in material) {
			material[field] = data[field];
		}
	}

	for (const mapName of MATERIAL_MAPS) {
		if (data[mapName] && mapName in material) {
			material[mapName] = deserializeTexture(data[mapName]);
		}
	}

	material.needsUpdate = true;
	return material;
}

function createMaterial(type) {
	switch (type) {
		case 'MeshBasicMaterial':
			return new THREE.MeshBasicMaterial();
		case 'MeshStandardMaterial':
			return new THREE.MeshStandardMaterial();
		case 'MeshPhongMaterial':
			return new THREE.MeshPhongMaterial();
		case 'MeshLambertMaterial':
			return new THREE.MeshLambertMaterial();
		case 'MeshMatcapMaterial':
			return new THREE.MeshMatcapMaterial();
		case 'LineBasicMaterial':
			return new THREE.LineBasicMaterial();
		case 'LineDashedMaterial':
			return new THREE.LineDashedMaterial();
		case 'PointsMaterial':
			return new THREE.PointsMaterial();
		default:
			return new THREE.MeshBasicMaterial();
	}
}

function serializeTexture(texture, context) {
	const data = {
		uuid: texture.uuid,
		name: texture.name,
		repeat: texture.repeat ? texture.repeat.toArray() : [1, 1],
		offset: texture.offset ? texture.offset.toArray() : [0, 0],
		center: texture.center ? texture.center.toArray() : [0, 0],
		image: null
	};

	for (const field of TEXTURE_FIELDS) {
		if (texture[field] !== undefined) {
			data[field] = texture[field];
		}
	}

	const image = texture.image;
	if (image?.data?.buffer) {
		addTransfer(image.data.buffer, context);
		data.image = {
			kind: 'data',
			width: image.width,
			height: image.height,
			buffer: image.data.buffer,
			byteOffset: image.data.byteOffset,
			length: image.data.length,
			arrayType: image.data.constructor.name
		};
	} else if (image?.src) {
		data.image = {
			kind: 'src',
			src: image.src
		};
	}

	return data;
}

function deserializeTexture(data) {
	let texture;

	if (data.image?.kind === 'data') {
		const ArrayConstructor = getTypedArrayConstructor(data.image.arrayType);
		const array = new ArrayConstructor(
			data.image.buffer,
			data.image.byteOffset || 0,
			data.image.length
		);

		texture = new THREE.DataTexture(array, data.image.width, data.image.height);
		texture.needsUpdate = true;
	} else if (data.image?.kind === 'src') {
		texture = new THREE.TextureLoader().load(data.image.src);
	} else {
		texture = new THREE.Texture();
	}

	texture.uuid = data.uuid || texture.uuid;
	texture.name = data.name || '';
	texture.repeat.fromArray(data.repeat || [1, 1]);
	texture.offset.fromArray(data.offset || [0, 0]);
	texture.center.fromArray(data.center || [0, 0]);

	for (const field of TEXTURE_FIELDS) {
		if (data[field] !== undefined && field in texture) {
			texture[field] = data[field];
		}
	}

	return texture;
}

function addTransfer(buffer, context) {
	if (!buffer || context.seenBuffers.has(buffer)) return;

	context.seenBuffers.add(buffer);
	context.transfer.push(buffer);
}

function getTypedArrayConstructor(name) {
	const ArrayConstructor = TYPED_ARRAYS[name];

	if (!ArrayConstructor) {
		throw new Error(`Unsupported typed array: ${name}`);
	}

	return ArrayConstructor;
}

function cloneUserData(userData) {
	if (!userData || Object.keys(userData).length === 0) return {};

	try {
		return structuredClone(userData);
	} catch {
		return {};
	}
}
