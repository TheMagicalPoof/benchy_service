<script>
	import * as THREE from 'three';
	import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
	import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
	import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
	import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
	import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
	import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
	import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
	import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
	import {
		Coord3D as O3DVCoord3D,
		Exporter as O3DVExporter,
		ExporterSettings as O3DVExporterSettings,
		FileFormat as O3DVFileFormat,
		Model as O3DVModel,
		Mesh as O3DVMesh,
		PhongMaterial as O3DVPhongMaterial,
		RGBColor as O3DVRGBColor,
		Triangle as O3DVTriangle
	} from 'online-3d-viewer';
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { calculateModelStats } from './ModelVolume.js';
	import { collectGeometryAnalysisPayload } from './GeometryAnalysis.js';
	import { canLoadWithOnline3DViewer, loadWithOnline3DViewer } from './Online3DViewerLoader.js';
	import { deserializeObject3D as deserializeThreeObject3D } from './ThreeSerializer.js';
	import { VIEW_CUBE_MODEL } from './ViewCubeAsset.js';

	import { onMount } from 'svelte';

	// export let borderRadius = "none";
	const dispatch = createEventDispatcher();

	export let enDrop = true;

	let sm;
	let wrapper;

	let viewField;
	let viewer;

	let spinner = false;
	let droparea = false;

	let worker;
	let workerReady;
	let currentFileName = '';
	let currentAnalysisOptions = createAnalysisOptions();
	let loadToken = 0;
	let currentLoadCacheKey = '';
	const modelCache = new Map();
	const allowedExtensions = [
		'.3dm',
		'.3ds',
		'.3mf',
		'.amf',
		'.bim',
		'.brep',
		'.brp',
		'.dae',
		'.fbx',
		'.fcstd',
		'.glb',
		'.gltf',
		'.ifc',
		'.iges',
		'.igs',
		'.obj',
		'.off',
		'.ply',
		'.stl',
		'.step',
		'.stp',
		'.wrl',
		'.zip'
	];
	const VIEW_CUBE_AXIS_VECTORS = {
		right: [1, 0, 0],
		left: [-1, 0, 0],
		back: [0, 1, 0],
		front: [0, -1, 0],
		top: [0, 0, 1],
		bottom: [0, 0, -1]
	};
	const VIEW_CUBE_BASE_SIZE = 184;
	const VIEW_CUBE_MIN_SIZE = 128;
	const VIEW_CUBE_MARGIN = 18;
	const VIEW_CUBE_TRANSITION_DURATION = 420;
	const DEFAULT_PROJECTION_MODE = 'perspective';
	const DEFAULT_VIEW_CUBE_VIEW = 'front-right';
	const VIEW_CUBE_ORIENTATION_CORRECTION = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(1, 0, 0),
		Math.PI / 2
	);
	const VIEW_CUBE_ORIENTATION_CORRECTION_INVERSE = VIEW_CUBE_ORIENTATION_CORRECTION.clone().invert();
	const DEFAULT_CAMERA_VIEW = getCameraViewFromViewCubeView(DEFAULT_VIEW_CUBE_VIEW);
	const AXES_HELPER_BASE_SIZE = 128;
	const AXES_HELPER_MIN_SIZE = 96;
	const AXES_HELPER_MARGIN = 16;
	const AXES_HELPER_VIEW_EXTENT = 1.48;
	const AXES_HELPER_CAMERA_DISTANCE = 4.2;
	const CAMERA_FOV = 75;
	const PROJECTION_TRANSITION_DURATION = 120;
	const PROJECTION_FLAT_FOV = 7;
	const VIEWER_BACKGROUND_STOPS = Object.freeze({
		center: '#cfd3d7',
		mid: '#9ea5ac',
		edge: '#4e5058'
	});
	const VIEWER_RENDER_SCALE = 2;
	const SNAPSHOT_RENDER_SCALE = 4;
	const SNAPSHOT_MAX_LONG_EDGE = 8192;
	const MODEL_CACHE_LIMIT = 6;
	const GTAO_SAMPLES = 16;
	const GTAO_DENOISE_SAMPLES = 16;
	const DEFAULT_SSAO_SETTINGS = Object.freeze({
		enabled: true,
		strength: 0.63,
		power: 0.8,
		radiusScale: 0.08,
		minDistance: 0,
		maxDistance: 0.2
	});
	const VIEW_CUBE_MATERIAL_COLORS = ['#c9d1db', '#b8c2cd', '#a9b4c0'];
	const VIEW_CUBE_FACE_AXES = ['right', 'left', 'front', 'back', 'top', 'bottom'];
	const VIEW_CUBE_FACE_COLORS = {
		right: '#d85f62',
		left: '#d85f62',
		front: '#2563eb',
		back: '#2563eb',
		top: '#22c55e',
		bottom: '#22c55e'
	};
	const VIEW_CUBE_LABEL_COLORS = {
		right: '#ffffff',
		left: '#ffffff',
		front: '#ffffff',
		back: '#ffffff',
		top: '#ffffff',
		bottom: '#ffffff'
	};
	const VIEW_CUBE_LABEL_ROTATIONS = {
		right: Math.PI / 2,
		left: -Math.PI / 2,
		back: Math.PI,
		top: Math.PI
	};
	const VIEW_CUBE_OUTLINE_COLOR = 0x1d4358;
	const VIEW_CUBE_FACE_LABELS = [
		{ label: 'RIGHT', normal: [1, 0, 0], up: [0, 0, 1] },
		{ label: 'LEFT', normal: [-1, 0, 0], up: [0, 0, 1] },
		{ label: 'BACK', normal: [0, 1, 0], up: [0, 0, 1] },
		{ label: 'FRONT', normal: [0, -1, 0], up: [0, 0, 1] },
		{ label: 'TOP', normal: [0, 0, 1], up: [0, 1, 0] },
		{ label: 'BOT', normal: [0, 0, -1], up: [0, -1, 0] }
	];

	function createSsaoSettings(settings = {}, fallback = DEFAULT_SSAO_SETTINGS) {
		const minDistance = clampNumber(settings.minDistance, 0, 0.05, fallback.minDistance);
		const maxDistance = clampNumber(settings.maxDistance, 0.001, 0.2, fallback.maxDistance);
		return {
			enabled: settings.enabled === undefined ? fallback.enabled : Boolean(settings.enabled),
			strength: clampNumber(settings.strength, 0, 1, fallback.strength),
			power: clampNumber(settings.power, 0.2, 4, fallback.power),
			radiusScale: clampNumber(settings.radiusScale, 0, 0.08, fallback.radiusScale),
			minDistance,
			maxDistance: Math.max(maxDistance, minDistance + 0.0001)
		};
	}

	function clampNumber(value, min, max, fallback) {
		const numberValue = Number(value);
		if (!Number.isFinite(numberValue)) return fallback;
		return THREE.MathUtils.clamp(numberValue, min, max);
	}

	function clampColorComponent(value) {
		const numberValue = Number(value);
		const clamped = Number.isFinite(numberValue) ? THREE.MathUtils.clamp(numberValue, 0, 1) : 0;
		return clamped.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
	}

	class SceneManager {
		constructor(viewer, resolutionWidth = 1920, resolutionHeight = 1080) {
			this.width = resolutionWidth;
			this.height = resolutionHeight;

			// DOM элемент
			this.viewer = viewer;

			// компоненты сцены
			this.renderer;
			this.camera;
			this.perspectiveCamera;
			this.orthographicCamera;
			this.projectionMode = 'perspective';
			this.controls;
			this.directionalLight;
			this.ambiantLight;
			this.scene;
			this.backgroundTexture;
			this.edgeScene;
			this.edgeCamera;
			this.edgeRenderTarget;
			this.edgeBackRenderTarget;
			this.edgeMaskRenderTarget;
			this.edgeBackMaskRenderTarget;
			this.edgeNormalMaterial;
			this.edgeBackNormalMaterial;
			this.edgeShaderMaterial;
			this.edgeCompositeMaterial;
			this.edgeQuad;
			this.ssaoComposer;
			this.ssaoRenderPass;
			this.ssaoPass;
			this.ssaoOutputPass;
			this.ssaoDepthPrepassMaterial;
			this.ssaoSettings = createSsaoSettings();
			this.ssaoEnabled = true;
			this.viewCubeScene;
			this.viewCubeCamera;
			this.viewCubeGroup;
			this.viewCubeMesh;
			this.viewCubeEdges;
			this.viewCubeLight;
			this.viewCubeHitTargets = [];
			this.viewCubeRaycaster = new THREE.Raycaster();
			this.viewCubePointer = new THREE.Vector2();
			this.viewCubeHoveredObject = null;
			this.axesScene;
			this.axesCamera;
			this.axesGroup;
			this.meshRaycaster = new THREE.Raycaster();
			this.meshPointer = new THREE.Vector2();
			this.hoveredMesh = null;
			this.selectedMeshId = '';
			this.meshPointerDown = null;
			this.meshPointerLast = null;
			this.focusMeshIds = new Set();
			this.focusSelectionSkeleton = false;
			this.selectionOutlines = [];
			this.selectionOutlineMaterial = new THREE.LineBasicMaterial({
				color: 0x55b7ee,
				depthTest: true,
				depthWrite: false,
				transparent: true,
				opacity: 0.95
			});
			this.exactSkeletonReady = false;
			this.exactSkeletonMaterial = new THREE.LineBasicMaterial({
				color: 0x10151c,
				depthTest: false,
				depthWrite: false,
				transparent: false
			});
			this.wireframeMaterial = new THREE.MeshBasicMaterial({
				color: 0x111820,
				wireframe: true,
				depthTest: true,
				depthWrite: false,
				transparent: true,
				opacity: 0.75
			});
			this.cadPanActive = false;
			this.cadPanPointerId = null;
			this.cadPanLast = new THREE.Vector2();
			this.cadPanDelta = new THREE.Vector2();
			this.cadPanEye = new THREE.Vector3();
			this.cadPanRight = new THREE.Vector3();
			this.cadPanUp = new THREE.Vector3();
			this.cadPanOffset = new THREE.Vector3();
			this.modelGroup = null;
			this.modelBounds = null;
			this.modelSphere = null;
			this.displayMode = 'solid';
			this.displayState = {
				solid: true,
				wire: false,
				skeleton: false,
				ghost: false
			};
			this.backfaceCulling = false;
			this.vertexColorsEnabled = true;
			this.viewCubeVerticalSign = 1;
			this.viewCubePrimaryFaceSnapView = '';
			this.cameraTransition = null;
			this.projectionTransition = null;
			this.needsRender = true;

			this._initScene();
		}

		autoScale(object3D) {
			// Вычисляем описанную сферу объекта
			const group = new THREE.Group();
			group.name = object3D.name || 'Model';

			const content = new THREE.Group();
			content.name = 'Model content';
			content.userData.isModelContent = true;
			content.add(object3D);
			group.add(content);
			group.updateMatrixWorld(true);

			const boundingBox = this._getObjectBounds(content);
			if (boundingBox.isEmpty()) return group;

			const center = boundingBox.getCenter(new THREE.Vector3());
			const centerInGroup = group.worldToLocal(center.clone());
			content.position.sub(centerInGroup);
			content.updateMatrixWorld(true);
			group.updateMatrixWorld(true);

			const centeredBox = this._getObjectBounds(content);
			const boundingSphere = new THREE.Sphere();
			centeredBox.getBoundingSphere(boundingSphere);

			// Получаем направление камеры
			

			// Вычисляем вектор от камеры до объекта
			

			// Проецируем вектор на направление камеры, чтобы получить расстояние вдоль линии взгляда
			

			if (!Number.isFinite(boundingSphere.radius) || boundingSphere.radius <= 0) {
				console.warn('Объект находится позади камеры или слишком близко.');
				return group;
			}

			// Вычисляем размеры фрустума на расстоянии до объекта
			

			// Вычисляем необходимый масштаб для вписывания объекта
			

			// Создаем группу и добавляем в нее объект
			// Сбрасываем позицию объекта внутри группы
			// Применяем масштаб к группе
			

			// Устанавливаем позицию группы так, чтобы объект был на нужном расстоянии и в центре вида камеры
			group.updateMatrixWorld(true);

			// Опционально: поворачиваем камеру на объект
			// this.camera.lookAt(newPosition);

			return group;
		}

		fitModel() {
			if (!this.modelGroup) return;
			this._fitCameraToObject(this.modelGroup);
		}

		resetView() {
			this._completeProjectionTransition();
			this._cancelCameraTransition();
			this._setProjectionModeImmediate(DEFAULT_PROJECTION_MODE);
			if (this.modelGroup) {
				this._fitCameraToObject(this.modelGroup, DEFAULT_CAMERA_VIEW, DEFAULT_VIEW_CUBE_VIEW);
				return;
			}

			const target = new THREE.Vector3(0, 0, 0);
			const pose = this._getViewPose(DEFAULT_CAMERA_VIEW, 5, DEFAULT_VIEW_CUBE_VIEW);
			this._setCameraPose(target, pose.offset, pose.up);
			this._syncControlsToActiveCamera(target);
			this.needsRender = true;
		}

		clearModel() {
			this._resetScene();
			this._setProjectionModeImmediate(DEFAULT_PROJECTION_MODE);
			const target = new THREE.Vector3(0, 0, 0);
			const pose = this._getViewPose(DEFAULT_CAMERA_VIEW, 5, DEFAULT_VIEW_CUBE_VIEW);
			this._setCameraPose(target, pose.offset, pose.up);
			this._syncControlsToActiveCamera(target);
			this.needsRender = true;
		}

		setProjectionMode(mode) {
			const nextMode = mode === 'orthographic' ? 'orthographic' : 'perspective';
			if (nextMode === this.projectionMode) return;

			this._startProjectionTransition(nextMode);
		}

		_startProjectionTransition(nextMode) {
			this._completeProjectionTransition();
			this._cancelCameraTransition();
			const target = this.controls.target.clone();
			const sourceCamera = this.camera;
			const sourceDistance = Math.max(sourceCamera.position.distanceTo(target), 0.001);
			const viewHeight = this._getCameraViewSizeForCamera(sourceCamera, sourceDistance).height;
			const direction = sourceCamera.position.clone().sub(target).normalize();

			if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();

			this.projectionMode = nextMode;
			this.camera = this.perspectiveCamera;
			this.controls.object = this.camera;
			this.projectionTransition = {
				mode: nextMode,
				startedAt: performance.now(),
				duration: PROJECTION_TRANSITION_DURATION,
				target,
				direction,
				up: sourceCamera.up.clone(),
				viewHeight,
				startFov: nextMode === 'orthographic' ? sourceCamera.fov || CAMERA_FOV : PROJECTION_FLAT_FOV,
				endFov: nextMode === 'orthographic' ? PROJECTION_FLAT_FOV : CAMERA_FOV
			};
			this._updateProjectionTransition(performance.now());
		}

		setView(view, options = {}) {
			if (!this.modelGroup) return;
			this._completeProjectionTransition();

			const rollView = options.rollView ?? null;
			if (!rollView) this.viewCubePrimaryFaceSnapView = '';
			const center = this._getObjectCenter(this.modelGroup);
			const radius = this._getObjectRadius(this.modelGroup);
			const distance = Math.max(radius * 2.8, 4);
			const pose = this._getViewPose(view, distance, rollView, {
				rollMode: options.rollMode || 'canonical'
			});
			const position = center.clone().add(pose.offset);
			const quaternion = this._getLookAtQuaternion(position, center, pose.up);
			const verticalSign = getViewVerticalSign(rollView || view);

			if (verticalSign !== 0) this.viewCubeVerticalSign = verticalSign;

			this._updateControlsDistanceLimits(radius, distance);
			this._startCameraTransition({
				position,
				target: center,
				quaternion,
				up: pose.up
			});
		}

		_getViewPose(view, distance, rollView = null, options = {}) {
			const exactPoses = {
				front: {
					offset: new THREE.Vector3(0, -distance, 0),
					up: new THREE.Vector3(0, 0, 1)
				},
				back: {
					offset: new THREE.Vector3(0, distance, 0),
					up: new THREE.Vector3(0, 0, 1)
				},
				left: {
					offset: new THREE.Vector3(-distance, 0, 0),
					up: new THREE.Vector3(0, 0, 1)
				},
				right: {
					offset: new THREE.Vector3(distance, 0, 0),
					up: new THREE.Vector3(0, 0, 1)
				},
				top: {
					offset: new THREE.Vector3(0, 0, distance),
					up: new THREE.Vector3(0, 1, 0)
				},
				bottom: {
					offset: new THREE.Vector3(0, 0, -distance),
					up: new THREE.Vector3(0, -1, 0)
				},
				iso: {
					offset: new THREE.Vector3(distance, -distance, distance),
					up: new THREE.Vector3(0, 0, 1)
				}
			};

			const hasRollView = rollView !== null && rollView !== undefined && rollView !== '';
			const rollSource = hasRollView ? rollView : view;

			if (exactPoses[view] && !hasRollView) return exactPoses[view];

			const direction = getViewDirection(view);
			if (direction.lengthSq() === 0) return exactPoses.iso;

			const normalizedDirection = direction.normalize();
			const rollDirection = getViewDirection(rollSource);
			const upReference = rollDirection.lengthSq() > 0 ? rollDirection.normalize() : normalizedDirection.clone();
			const preferredUp = getViewUpVector(rollSource, upReference, this.viewCubeVerticalSign);
			const canonicalUp = getSafeViewUpVector(preferredUp, normalizedDirection);
			const currentScreenUp = new THREE.Vector3(0, 1, 0)
				.applyQuaternion(this.camera.quaternion)
				.normalize();
			const up =
				options.rollMode === 'nearest'
					? getNearestSnappedUpVector(normalizedDirection, currentScreenUp, canonicalUp)
					: canonicalUp;

			return {
				offset: normalizedDirection.multiplyScalar(distance),
				up
			};
		}

		setDisplayMode(mode) {
			this.displayMode = mode;
			const legacyStates = {
				solid: { solid: true, wire: false, skeleton: false, ghost: false },
				wireframe: { solid: false, wire: true, skeleton: false, ghost: false },
				skeleton: { solid: false, wire: false, skeleton: true, ghost: false },
				transparent: { solid: true, wire: false, skeleton: false, ghost: true },
				'ghost-skeleton': { solid: true, wire: false, skeleton: true, ghost: true }
			};
			this.displayState = {
				...this.displayState,
				...(legacyStates[mode] || legacyStates.solid)
			};
			this._applyDisplayMode();
			this.needsRender = true;
		}

		setDisplayState(state = {}) {
			this.displayState = {
				solid: Boolean(state.solid),
				wire: Boolean(state.wire),
				skeleton: Boolean(state.skeleton),
				ghost: Boolean(state.ghost)
			};

			this.displayMode = [
				this.displayState.solid ? 'solid' : '',
				this.displayState.wire ? 'wire' : '',
				this.displayState.skeleton ? 'skeleton' : '',
				this.displayState.ghost ? 'ghost' : ''
			]
				.filter(Boolean)
				.join('+');
			this._applyDisplayMode();
			this.needsRender = true;
		}

		setBackfaceCulling(enabled) {
			this.backfaceCulling = Boolean(enabled);
			this._applyBackfaceCulling();
			this.needsRender = true;
		}

		setVertexColorsEnabled(enabled) {
			this.vertexColorsEnabled = Boolean(enabled);
			this._applyVertexColorsEnabled();
			this.needsRender = true;
		}

		setSsaoSettings(settings = {}) {
			this.ssaoSettings = createSsaoSettings(settings, this.ssaoSettings);
			this._applySsaoSettings();
			this.needsRender = true;
		}

		setMeshColor(meshId, color) {
			if (!this.modelGroup || !isHexColor(color)) return false;

			let targetMesh = null;
			this.modelGroup.traverse((object) => {
				if (!targetMesh && object.isMesh && object.uuid === meshId) {
					targetMesh = object;
				}
			});

			if (!targetMesh || !targetMesh.material) return false;

			this._ensureUniqueMeshMaterials(targetMesh);
			const materials = Array.isArray(targetMesh.material) ? targetMesh.material : [targetMesh.material];
			const nextColor = new THREE.Color(color);

			for (const material of materials) {
				if (!material?.color) continue;
				material.color.copy(nextColor);
				if (material.emissive) {
					material.emissive.copy(nextColor).multiplyScalar(0.18);
				}
				material.needsUpdate = true;
			}

			this.needsRender = true;
			return true;
		}

		selectMesh(meshId) {
			return this.focusMeshes([meshId], { skeleton: true });
		}

		focusMeshes(meshIds, { skeleton = true } = {}) {
			const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
			const meshes = ids.map((meshId) => this._findMeshById(meshId)).filter(Boolean);

			if (!this.modelGroup || meshes.length === 0) return false;

			if (!this.displayState.solid || this.displayState.wire || this.displayState.ghost) {
				this.displayState = {
					...this.displayState,
					solid: true,
					wire: false,
					ghost: false
				};
				this.displayMode = [
					this.displayState.solid ? 'solid' : '',
					this.displayState.wire ? 'wire' : '',
					this.displayState.skeleton ? 'skeleton' : '',
					this.displayState.ghost ? 'ghost' : ''
				]
					.filter(Boolean)
					.join('+');
			}
			this.focusMeshIds = new Set(meshes.map((mesh) => mesh.uuid));
			this.focusSelectionSkeleton = Boolean(skeleton);
			this.selectedMeshId = meshes[0].uuid;
			this._setSelectionOutline(meshes);
			this._applyDisplayMode();
			this.needsRender = true;
			return true;
		}

		clearMeshFocus() {
			this.focusMeshIds = new Set();
			this.focusSelectionSkeleton = false;
			this._clearSelectionOutline();
			this._applyDisplayMode();
			this.needsRender = true;
		}

		setMeshVisibility(meshId, visible, { emit = false } = {}) {
			if (!this.modelGroup || !meshId) return false;

			const mesh = this._findMeshById(meshId);
			if (!mesh) return false;

			mesh.visible = Boolean(visible);
			if (!mesh.visible && this.hoveredMesh?.uuid === meshId) this.hoveredMesh = null;
			if (!mesh.visible && this.selectedMeshId !== meshId) this.selectedMeshId = meshId;
			if (!mesh.visible && this.focusMeshIds.has(meshId)) {
				this.focusMeshIds.delete(meshId);
				if (this.focusMeshIds.size === 0) this.focusSelectionSkeleton = false;
			}
			if (this.focusMeshIds.size > 0) {
				const focusedMeshes = Array.from(this.focusMeshIds).map((id) => this._findMeshById(id)).filter(Boolean);
				this._setSelectionOutline(focusedMeshes);
			} else {
				this._clearSelectionOutline();
			}
			this._applyDisplayMode();

			this.needsRender = true;
			if (emit) {
				dispatch('meshvisibility', {
					meshId,
					visible: mesh.visible
				});
			}
			return true;
		}

		setMeshesVisibility(meshIds, visible, options = {}) {
			const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
			let changed = false;

			for (const meshId of ids) {
				changed = this.setMeshVisibility(meshId, visible, options) || changed;
			}

			return changed;
		}

		_findMeshById(meshId) {
			let targetMesh = null;
			this.modelGroup?.traverse((object) => {
				if (!targetMesh && object.isMesh && object.uuid === meshId) {
					targetMesh = object;
				}
			});
			return targetMesh;
		}

		_getModelMeshes({ includeHidden = false } = {}) {
			const meshes = [];
			this.modelGroup?.traverse((object) => {
				if (!object.isMesh) return;
				if (!includeHidden && !this._isObjectEffectivelyVisible(object)) return;
				meshes.push(object);
			});
			return meshes;
		}

		_getVisibleModelMeshes() {
			return this._getModelMeshes();
		}

		_isObjectEffectivelyVisible(object) {
			let current = object;
			while (current) {
				if (!current.visible) return false;
				if (current === this.modelGroup) break;
				current = current.parent;
			}
			return true;
		}

		_setSelectionOutline(mesh) {
			this._clearSelectionOutline();
			if (!this.focusSelectionSkeleton) return;

			const meshes = Array.isArray(mesh) ? mesh : [mesh];
			for (const targetMesh of meshes) {
				if (!targetMesh?.geometry || !this._isObjectEffectivelyVisible(targetMesh)) continue;
				if ((targetMesh.children || []).some((child) => child.userData?.isExactSkeletonEdge)) continue;

				const geometry = new THREE.EdgesGeometry(targetMesh.geometry, 24);
				const outline = new THREE.LineSegments(geometry, this.selectionOutlineMaterial);
				outline.name = `${targetMesh.name || 'Mesh'} selection`;
				outline.frustumCulled = false;
				outline.renderOrder = 1300;
				outline.userData.isSelectionOutline = true;
				targetMesh.add(outline);
				this.selectionOutlines.push(outline);
			}
		}

		_clearSelectionOutline() {
			if (!this.selectionOutlines?.length) return;

			for (const outline of this.selectionOutlines) {
				outline.parent?.remove(outline);
				outline.geometry?.dispose();
			}
			this.selectionOutlines = [];
		}

		_ensureUniqueMeshMaterials(mesh) {
			if (mesh.userData?.hasNavigatorMaterialOverride || !mesh.material) return;

			mesh.material = Array.isArray(mesh.material)
				? mesh.material.map((material) => material?.clone?.() || material)
				: mesh.material.clone?.() || mesh.material;
			mesh.userData = {
				...(mesh.userData || {}),
				hasNavigatorMaterialOverride: true
			};
		}

		attachSkeleton(items = []) {
			if (!this.modelGroup) return;

			this._clearExactSkeleton();

			const meshesById = new Map();
			this.modelGroup.traverse((object) => {
				if (object.isMesh) meshesById.set(object.uuid, object);
			});

			let attachedCount = 0;
			for (const item of items) {
				const mesh = meshesById.get(item.id);
				if (!mesh || !item.linePositions || item.linePositions.length === 0) continue;

				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute('position', new THREE.BufferAttribute(item.linePositions, 3));

				const lines = new THREE.LineSegments(geometry, this.exactSkeletonMaterial);
				lines.name = `${mesh.name || item.name || 'mesh'} skeleton`;
				lines.frustumCulled = false;
				lines.renderOrder = 1000;
				lines.userData.isExactSkeletonEdge = true;
				lines.userData.sourceMeshId = mesh.uuid;
				lines.visible = false;
				mesh.add(lines);
				attachedCount += 1;
			}

			this.exactSkeletonReady = attachedCount > 0;
			this._applyDisplayMode();
			this.needsRender = true;
		}

		snapshot() {
			if (!this.renderer?.domElement) return '';

			const restoreSnapshotRender = this._prepareSnapshotRender();
			try {
				this._renderSnapshotFrame();
				return this.renderer.domElement.toDataURL('image/png');
			} finally {
				restoreSnapshotRender();
			}
		}

		async snapshotBlob() {
			if (!this.renderer?.domElement) return null;

			const restoreSnapshotRender = this._prepareSnapshotRender();
			try {
				this._renderSnapshotFrame();
				return await new Promise((resolve) => {
					this.renderer.domElement.toBlob((blob) => resolve(blob), 'image/png');
				});
			} finally {
				restoreSnapshotRender();
			}
		}

		async exportModel(format, options = {}) {
			if (!this.modelGroup) return [];

			const normalizedFormat = String(format || '').toLowerCase();
			const fileBaseName = this._sanitizeExportName(options.baseName || 'model');
			const exportRoot = this._createExportObject();
			if (!exportRoot) return [];

			if (normalizedFormat === 'glb') {
				const data = await this._exportGltf(exportRoot, { binary: true });
				return [
					{
						fileName: `${fileBaseName}.glb`,
						extension: 'glb',
						mimeType: 'model/gltf-binary',
						blob: new Blob([data], { type: 'model/gltf-binary' })
					}
				];
			}

			if (normalizedFormat === 'gltf') {
				const data = await this._exportGltf(exportRoot, { binary: false });
				return [
					{
						fileName: `${fileBaseName}.gltf`,
						extension: 'gltf',
						mimeType: 'model/gltf+json',
						blob: new Blob([JSON.stringify(data, null, 2)], { type: 'model/gltf+json' })
					}
				];
			}

			if (normalizedFormat === 'obj') {
				const files = this._exportObjWithMtl(exportRoot, `${fileBaseName}.mtl`);
				return [
					{
						fileName: `${fileBaseName}.obj`,
						extension: 'obj',
						mimeType: 'text/plain',
						blob: new Blob([files.obj], { type: 'text/plain' })
					},
					{
						fileName: `${fileBaseName}.mtl`,
						extension: 'mtl',
						mimeType: 'text/plain',
						blob: new Blob([files.mtl], { type: 'text/plain' })
					}
				];
			}

			if (normalizedFormat === 'stl' || normalizedFormat === 'stl-binary') {
				const data = new STLExporter().parse(exportRoot, { binary: true });
				return [
					{
						fileName: `${fileBaseName}.stl`,
						extension: 'stl',
						mimeType: 'model/stl',
						blob: new Blob([data], { type: 'model/stl' })
					}
				];
			}

			if (normalizedFormat === 'stl-ascii' || normalizedFormat === 'stl-text') {
				const data = new STLExporter().parse(exportRoot, { binary: false });
				return [
					{
						fileName: `${fileBaseName}.stl`,
						extension: 'stl',
						mimeType: 'model/stl',
						blob: new Blob([data], { type: 'model/stl' })
					}
				];
			}

			if (normalizedFormat === 'ply' || normalizedFormat === 'ply-binary') {
				const data = new PLYExporter().parse(exportRoot, null, {
					binary: true,
					littleEndian: true
				});
				return [
					{
						fileName: `${fileBaseName}.ply`,
						extension: 'ply',
						mimeType: 'application/octet-stream',
						blob: new Blob([data], { type: 'application/octet-stream' })
					}
				];
			}

			if (normalizedFormat === 'ply-ascii' || normalizedFormat === 'ply-text') {
				const data = new PLYExporter().parse(exportRoot, null, {
					binary: false
				});
				return [
					{
						fileName: `${fileBaseName}.ply`,
						extension: 'ply',
						mimeType: 'text/plain',
						blob: new Blob([data], { type: 'text/plain' })
					}
				];
			}

			if (normalizedFormat === 'off') {
				const data = this._exportOff(exportRoot);
				return [
					{
						fileName: `${fileBaseName}.off`,
						extension: 'off',
						mimeType: 'text/plain',
						blob: new Blob([data], { type: 'text/plain' })
					}
				];
			}

			if (normalizedFormat === 'bim') {
				return this._exportOnline3DViewer(exportRoot, {
					fileBaseName,
					extension: 'bim',
					format: O3DVFileFormat.Text,
					mimeType: 'application/json'
				});
			}

			if (normalizedFormat === '3dm') {
				return this._exportOnline3DViewer(exportRoot, {
					fileBaseName,
					extension: '3dm',
					format: O3DVFileFormat.Binary,
					mimeType: 'application/octet-stream'
				});
			}

			throw new Error(`Unsupported export format: ${format}`);
		}

		_createExportObject() {
			const root = new THREE.Group();
			root.name = this._sanitizeExportName(this.modelGroup.name || 'model');
			let meshIndex = 0;

			this.modelGroup.updateMatrixWorld(true);
			this.modelGroup.traverse((object) => {
				if (!object.isMesh || !object.geometry || !this._isObjectWorldVisible(object)) return;
				if (object.userData?.isSelectionOutline || object.userData?.isExactSkeletonEdge) return;

				const geometry = object.geometry.clone();
				const material = this._cloneExportMaterials(object.material, object.name || `mesh_${meshIndex + 1}`);
				const mesh = new THREE.Mesh(geometry, material);
				mesh.name = this._sanitizeExportName(object.name || `mesh_${meshIndex + 1}`);
				mesh.matrix.copy(object.matrixWorld);
				mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
				mesh.updateMatrixWorld(true);
				root.add(mesh);
				meshIndex += 1;
			});

			if (meshIndex === 0) return null;
			root.updateMatrixWorld(true);
			return root;
		}

		_cloneExportMaterials(material, fallbackName) {
			const materials = Array.isArray(material) ? material : [material];
			const clonedMaterials = materials.map((sourceMaterial, index) => {
				const sourceColor = sourceMaterial?.color?.clone?.() || new THREE.Color(0xcccccc);
				const exportMaterial = new THREE.MeshStandardMaterial({
					name: this._sanitizeExportName(sourceMaterial?.name || `${fallbackName}_${index + 1}`),
					color: sourceColor,
					roughness: 0.72,
					metalness: 0.02,
					side: sourceMaterial?.side ?? THREE.FrontSide,
					transparent: false,
					opacity: 1
				});

				if (sourceMaterial?.emissive) {
					exportMaterial.emissive.copy(sourceMaterial.emissive);
				}
				return exportMaterial;
			});

			return Array.isArray(material) ? clonedMaterials : clonedMaterials[0];
		}

		_isObjectWorldVisible(object) {
			let current = object;
			while (current) {
				if (current.visible === false) return false;
				if (current === this.modelGroup) break;
				current = current.parent;
			}
			return true;
		}

		_exportGltf(object, options = {}) {
			return new Promise((resolve, reject) => {
				new GLTFExporter().parse(object, resolve, reject, {
					binary: Boolean(options.binary),
					onlyVisible: true,
					truncateDrawRange: true
				});
			});
		}

		async _exportOnline3DViewer(object, options) {
			const model = this._createOnline3DViewerModel(object);
			const exportedFiles = await new Promise((resolve, reject) => {
				new O3DVExporter().Export(
					model,
					new O3DVExporterSettings(),
					options.format,
					options.extension,
					{
						onSuccess: resolve,
						onError: () => reject(new Error(`Failed to export ${options.extension.toUpperCase()}`))
					}
				);
			});

			return exportedFiles.map((file, index) => {
				const originalName = file.GetName?.() || `${options.fileBaseName}.${options.extension}`;
				const extension = originalName.split('.').pop()?.toLowerCase() || options.extension;
				const fileName =
					exportedFiles.length === 1
						? `${options.fileBaseName}.${extension}`
						: `${options.fileBaseName}_${index + 1}.${extension}`;
				return {
					fileName,
					extension,
					mimeType: options.mimeType,
					blob: new Blob([file.GetBufferContent()], { type: options.mimeType })
				};
			});
		}

		_createOnline3DViewerModel(object) {
			const model = new O3DVModel();
			const materialCache = new Map();
			const vertex = new THREE.Vector3();
			const normalVector = new THREE.Vector3();
			const normalMatrix = new THREE.Matrix3();

			const getMaterialIndex = (material, fallbackName) => {
				const materialKey = material?.uuid || material?.name || fallbackName || 'default';
				if (materialCache.has(materialKey)) return materialCache.get(materialKey);

				const color = material?.color?.clone?.() || new THREE.Color(0xcccccc);
				color.convertLinearToSRGB();
				const o3dvMaterial = new O3DVPhongMaterial();
				o3dvMaterial.name = this._sanitizeExportName(material?.name || fallbackName || 'material');
				o3dvMaterial.color = new O3DVRGBColor(
					Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255),
					Math.round(THREE.MathUtils.clamp(color.g, 0, 1) * 255),
					Math.round(THREE.MathUtils.clamp(color.b, 0, 1) * 255)
				);
				o3dvMaterial.opacity = 1;
				o3dvMaterial.transparent = false;

				const materialIndex = model.AddMaterial(o3dvMaterial);
				materialCache.set(materialKey, materialIndex);
				return materialIndex;
			};

			const getGroupMaterialIndex = (groups, offset) => {
				for (const group of groups) {
					const count = group.count === Infinity ? Number.MAX_SAFE_INTEGER : group.count;
					if (offset >= group.start && offset < group.start + count) {
						return group.materialIndex || 0;
					}
				}
				return 0;
			};

			object.updateMatrixWorld(true);
			object.traverse((mesh) => {
				if (!mesh.isMesh || !mesh.geometry) return;

				const geometry = mesh.geometry;
				const position = geometry.getAttribute('position');
				if (!position) return;

				const index = geometry.getIndex();
				const normal = geometry.getAttribute('normal');
				const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
				const materialIndices = materials.map((material, index) =>
					getMaterialIndex(material, `${mesh.name || 'mesh'}_${index + 1}`)
				);
				const groups = geometry.groups?.length
					? geometry.groups
					: [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
				const o3dvMesh = new O3DVMesh();
				o3dvMesh.SetName(this._sanitizeExportName(mesh.name || 'mesh'));

				for (let i = 0; i < position.count; i += 1) {
					vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
					o3dvMesh.AddVertex(new O3DVCoord3D(vertex.x, vertex.y, vertex.z));
				}

				if (normal) {
					normalMatrix.getNormalMatrix(mesh.matrixWorld);
					for (let i = 0; i < normal.count; i += 1) {
						normalVector.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
						o3dvMesh.AddNormal(new O3DVCoord3D(normalVector.x, normalVector.y, normalVector.z));
					}
				}

				const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
				for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
					const offset = triangleIndex * 3;
					const v0 = index ? index.getX(offset) : offset;
					const v1 = index ? index.getX(offset + 1) : offset + 1;
					const v2 = index ? index.getX(offset + 2) : offset + 2;
					const triangle = new O3DVTriangle(v0, v1, v2);
					if (normal) {
						triangle.SetNormals(v0, v1, v2);
					}
					const sourceMaterialIndex = getGroupMaterialIndex(groups, offset);
					triangle.SetMaterial(materialIndices[sourceMaterialIndex] ?? materialIndices[0]);
					o3dvMesh.AddTriangle(triangle);
				}

				if (o3dvMesh.TriangleCount() > 0) {
					model.AddMeshToRootNode(o3dvMesh);
				}
			});

			return model;
		}

		_exportObjWithMtl(object, mtlFileName = 'model.mtl') {
			const vertices = new THREE.Vector3();
			const normals = new THREE.Vector3();
			const normalMatrix = new THREE.Matrix3();
			const materialNames = new Map();
			let obj = `mtllib ${mtlFileName}\n`;
			let mtl = '';
			let vertexOffset = 1;
			let normalOffset = 1;
			let uvOffset = 1;

			const getMaterialName = (material) => {
				const materialKey = material?.uuid || material?.name || `material_${materialNames.size + 1}`;
				if (materialNames.has(materialKey)) return materialNames.get(materialKey);

				const materialName = this._sanitizeExportName(material?.name || `material_${materialNames.size + 1}`);
				const color = material?.color?.clone?.() || new THREE.Color(0xcccccc);
				color.convertLinearToSRGB();
				const emissive = material?.emissive?.clone?.() || new THREE.Color(0x000000);
				emissive.convertLinearToSRGB();
				const shininess = Number.isFinite(material?.roughness) ? Math.round((1 - material.roughness) * 100) : 18;
				mtl += `newmtl ${materialName}\n`;
				mtl += `Kd ${clampColorComponent(color.r)} ${clampColorComponent(color.g)} ${clampColorComponent(color.b)}\n`;
				mtl += `Ka 0 0 0\n`;
				mtl += `Ke ${clampColorComponent(emissive.r)} ${clampColorComponent(emissive.g)} ${clampColorComponent(emissive.b)}\n`;
				mtl += `Ks 0.08 0.08 0.08\n`;
				mtl += `Ns ${Math.max(1, shininess)}\n`;
				mtl += `d 1\n\n`;
				materialNames.set(materialKey, materialName);
				return materialName;
			};

			object.updateMatrixWorld(true);
			object.traverse((mesh) => {
				if (!mesh.isMesh || !mesh.geometry) return;

				const geometry = mesh.geometry;
				const position = geometry.getAttribute('position');
				if (!position) return;

				const normal = geometry.getAttribute('normal');
				const uv = geometry.getAttribute('uv');
				const index = geometry.getIndex();
				const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
				const groups = geometry.groups?.length
					? geometry.groups
					: [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];

				obj += `o ${this._sanitizeExportName(mesh.name || 'mesh')}\n`;
				for (let i = 0; i < position.count; i += 1) {
					vertices.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
					obj += `v ${vertices.x} ${vertices.y} ${vertices.z}\n`;
				}

				if (uv) {
					for (let i = 0; i < uv.count; i += 1) {
						obj += `vt ${uv.getX(i)} ${uv.getY(i)}\n`;
					}
				}

				if (normal) {
					normalMatrix.getNormalMatrix(mesh.matrixWorld);
					for (let i = 0; i < normal.count; i += 1) {
						normals.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
						obj += `vn ${normals.x} ${normals.y} ${normals.z}\n`;
					}
				}

				for (const group of groups) {
					const material = materials[group.materialIndex] || materials[0];
					obj += `usemtl ${getMaterialName(material)}\n`;
					const groupEnd = group.start + group.count;

					for (let i = group.start; i < groupEnd; i += 3) {
						const face = [];
						for (let corner = 0; corner < 3; corner += 1) {
							const vertexIndex = index ? index.getX(i + corner) : i + corner;
							const v = vertexOffset + vertexIndex;
							const vt = uv ? uvOffset + vertexIndex : '';
							const vn = normal ? normalOffset + vertexIndex : '';
							if (uv && normal) {
								face.push(`${v}/${vt}/${vn}`);
							} else if (normal) {
								face.push(`${v}//${vn}`);
							} else if (uv) {
								face.push(`${v}/${vt}`);
							} else {
								face.push(`${v}`);
							}
						}
						obj += `f ${face.join(' ')}\n`;
					}
				}

				vertexOffset += position.count;
				if (normal) normalOffset += normal.count;
				if (uv) uvOffset += uv.count;
			});

			return { obj, mtl };
		}

		_exportOff(object) {
			const vertex = new THREE.Vector3();
			const vertices = [];
			const faces = [];

			object.updateMatrixWorld(true);
			object.traverse((mesh) => {
				if (!mesh.isMesh || !mesh.geometry) return;

				const geometry = mesh.geometry;
				const position = geometry.getAttribute('position');
				const index = geometry.getIndex();
				if (!position) return;

				const vertexStart = vertices.length;
				for (let i = 0; i < position.count; i += 1) {
					vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
					vertices.push(`${vertex.x} ${vertex.y} ${vertex.z}`);
				}

				if (index) {
					for (let i = 0; i < index.count; i += 3) {
						faces.push(`3 ${vertexStart + index.getX(i)} ${vertexStart + index.getX(i + 1)} ${vertexStart + index.getX(i + 2)}`);
					}
				} else {
					for (let i = 0; i < position.count; i += 3) {
						faces.push(`3 ${vertexStart + i} ${vertexStart + i + 1} ${vertexStart + i + 2}`);
					}
				}
			});

			return `OFF\n${vertices.length} ${faces.length} 0\n${vertices.join('\n')}\n${faces.join('\n')}\n`;
		}

		_sanitizeExportName(name) {
			const cleaned = String(name || '')
				.trim()
				.replace(/[^\w.-]+/g, '_')
				.replace(/^_+|_+$/g, '');
			return cleaned || 'model';
		}

		_renderSnapshotFrame() {
			this._renderFrame({
				includeHelpers: false,
				transparentBackground: true,
				useSsao: false
			});
		}

		_prepareSnapshotRender() {
			const previousWidth = this.width;
			const previousHeight = this.height;
			const previousPixelRatio = this.renderer.getPixelRatio();
			const previousRenderTarget = this.renderer.getRenderTarget();
			const previousViewport = this.renderer.getViewport(new THREE.Vector4());
			const previousScissor = this.renderer.getScissor(new THREE.Vector4());
			const previousScissorTest = this.renderer.getScissorTest();
			const previousNeedsRender = this.needsRender;
			const snapshotSize = this._getSnapshotSize();

			this.width = snapshotSize.width;
			this.height = snapshotSize.height;
			this.renderer.setPixelRatio(1);
			this.renderer.setSize(snapshotSize.width, snapshotSize.height, false);
			this.renderer.setRenderTarget(null);
			this.renderer.setViewport(0, 0, snapshotSize.width, snapshotSize.height);
			this.renderer.setScissor(0, 0, snapshotSize.width, snapshotSize.height);
			this.renderer.setScissorTest(false);
			this._updateActiveCameraProjection();
			this._resizeSsaoPass();
			this._resizeGpuSkeletonPass();

			return () => {
				this.width = previousWidth;
				this.height = previousHeight;
				this.renderer.setPixelRatio(previousPixelRatio);
				this.renderer.setSize(previousWidth, previousHeight, false);
				this.renderer.setRenderTarget(previousRenderTarget);
				this.renderer.setViewport(previousViewport);
				this.renderer.setScissor(previousScissor);
				this.renderer.setScissorTest(previousScissorTest);
				this._updateActiveCameraProjection();
				this._resizeSsaoPass();
				this._resizeGpuSkeletonPass();
				this.needsRender = true;
			};
		}

		_getSnapshotSize() {
			const baseWidth = Math.max(1, Math.round(this.width || this.viewer?.clientWidth || 1));
			const baseHeight = Math.max(1, Math.round(this.height || this.viewer?.clientHeight || 1));
			let width = Math.max(1, Math.round(baseWidth * SNAPSHOT_RENDER_SCALE));
			let height = Math.max(1, Math.round(baseHeight * SNAPSHOT_RENDER_SCALE));
			const longEdge = Math.max(width, height);

			if (longEdge > SNAPSHOT_MAX_LONG_EDGE) {
				const scale = SNAPSHOT_MAX_LONG_EDGE / longEdge;
				width = Math.max(1, Math.round(width * scale));
				height = Math.max(1, Math.round(height * scale));
			}

			return { width, height };
		}

		_setControlsTarget(object3D) {
			object3D.updateMatrixWorld(true);

			this.controls.target.copy(this._getObjectCenter(object3D));
			this.controls.update();
		}

		viewerResize(
			resolutionWidth = 1920,
			resolutionHeight = 1080 // Ресайз окна сцены
		) {
			// height = viewField.clientHeight;
			// width = viewField.clientWidth;

			this.height = resolutionHeight;
			this.width = resolutionWidth;
			this._updateActiveCameraProjection();
			this.renderer.setSize(this.width, this.height);
			this._syncControlsScreen();
			this._updateSceneBackground();
			this._resizeSsaoPass();
			this._resizeGpuSkeletonPass();
			this.needsRender = true;
		}

		updateScene(
			odject3D // Обновить сцену, с элементами в массиве
		) {
			this._resetScene();

			const lights = new THREE.Group();
			lights.add(this.ambiantLight);
			lights.add(this.directionalLight);
			this.scene.add(lights);

			// this.scene.add(createFrustumVisual(this.camera));

			this.modelGroup = this.autoScale(odject3D);
			this._prepareModelMaterials(this.modelGroup);
			this.scene.add(this.modelGroup);
			this._cacheModelBounds(this.modelGroup);
			this._setProjectionModeImmediate(DEFAULT_PROJECTION_MODE);
			this._fitCameraToObject(this.modelGroup, DEFAULT_CAMERA_VIEW, DEFAULT_VIEW_CUBE_VIEW);
			this._applyDisplayMode();
			this.needsRender = true;
		}

		_prepareModelMaterials(object3D) {
			object3D.traverse((object) => {
				if (!object.isMesh || !object.material) return;

				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					if (!material) continue;
					if (!material.userData) material.userData = {};
					if (material.userData.baseSide === undefined) {
						material.userData.baseSide = material.side ?? THREE.FrontSide;
					}
					if (material.userData.baseVertexColors === undefined) {
						material.userData.baseVertexColors = Boolean(material.vertexColors);
					}

					if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
						material.roughness = Math.max(material.roughness ?? 0, 0.82);
						material.metalness = Math.min(material.metalness ?? 0, 0.04);
						if ('envMapIntensity' in material) material.envMapIntensity = Math.min(material.envMapIntensity ?? 1, 0.25);
						if ('clearcoat' in material) material.clearcoat = Math.min(material.clearcoat ?? 0, 0.05);
						if ('specularIntensity' in material) material.specularIntensity = Math.min(material.specularIntensity ?? 1, 0.22);
					}

					if (material.isMeshPhongMaterial) {
						material.specular?.setHex(0x08090a);
						material.shininess = Math.min(material.shininess ?? 30, 6);
					}

					this._applyMaterialVertexColors(material);
					material.needsUpdate = true;
				}
			});
		}

		_resetScene() {
			this._cancelCameraTransition();
			this._cancelProjectionTransition();
			// Сбросить сцену
			this._clearSelectionOutline();
			this._clearExactSkeleton();
			this.scene.clear();
			this.modelGroup = null;
			this.modelBounds = null;
			this.modelSphere = null;
			this.exactSkeletonReady = false;
			this.viewCubePrimaryFaceSnapView = '';
			this.needsRender = true;
			// this._initCamera();
		}

		_fitCameraToObject(object3D, view = '', rollView = null) {
			this._completeProjectionTransition();
			this._cancelCameraTransition();
			const bounds = this._getObjectBounds(object3D);
			if (bounds.isEmpty()) return;

			const center = bounds.getCenter(new THREE.Vector3());
			const sphere = bounds.getBoundingSphere(new THREE.Sphere());
			const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
			const aspect = Math.max(this.width / Math.max(this.height, 1), 0.001);
			const margin = 1.14;
			const verticalFov = THREE.MathUtils.degToRad(CAMERA_FOV);
			const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
			const fitFov = Math.max(Math.min(verticalFov, horizontalFov), 0.001);
			const perspectiveDistance = (radius / Math.sin(fitFov / 2)) * margin;
			const distance = Math.max(perspectiveDistance, radius * 1.8, 4);
			const viewDirection = view ? getViewDirection(view) : null;
			const direction = viewDirection?.lengthSq()
				? viewDirection.normalize()
				: this.camera.position.clone().sub(this.controls.target).normalize();
			const rollSource = rollView || view;
			const rollDirection = rollSource ? getViewDirection(rollSource) : null;
			const upReference = rollDirection?.lengthSq() ? rollDirection.normalize() : direction.clone();
			const preferredUp = view ? getViewUpVector(rollSource, upReference, this.viewCubeVerticalSign) : this.camera.up.clone();
			const up = getSafeViewUpVector(preferredUp, direction);
			const verticalSign = getViewVerticalSign(rollSource);

			if (direction.lengthSq() === 0) {
				direction.copy(getViewDirection(DEFAULT_CAMERA_VIEW).normalize());
			}

			if (verticalSign !== 0) this.viewCubeVerticalSign = verticalSign;

			this.camera.position.copy(center).add(direction.multiplyScalar(distance));
			this.camera.up.copy(up);
			this.camera.quaternion.copy(this._getLookAtQuaternion(this.camera.position, center, up));
			if (this.camera.isOrthographicCamera) {
				this.camera.zoom = 1;
				this._setOrthographicViewHeight((radius * 2 * margin) / Math.min(aspect, 1));
			}
			this.controls.target.copy(center);
			this._applyCameraClipping(sphere);
			this._updateControlsDistanceLimits(radius, distance);
			this.controls.update();
			this.needsRender = true;
		}

		_setProjectionModeImmediate(mode = DEFAULT_PROJECTION_MODE) {
			this._cancelProjectionTransition();
			const nextMode = mode === 'orthographic' ? 'orthographic' : 'perspective';

			if (nextMode === 'orthographic') {
				this._syncOrthographicFromCamera(
					this.camera || this.perspectiveCamera,
					this.controls?.target || new THREE.Vector3()
				);
				this.camera = this.orthographicCamera;
			} else {
				this.camera = this.perspectiveCamera;
				this.perspectiveCamera.fov = CAMERA_FOV;
				this.perspectiveCamera.aspect = this.width / Math.max(this.height, 1);
				this.perspectiveCamera.updateProjectionMatrix();
			}

			this.projectionMode = nextMode;
			if (this.controls) {
				this.controls.object = this.camera;
			}
		}

		_cacheModelBounds(object3D) {
			const bounds = this._getObjectBounds(object3D);
			if (bounds.isEmpty()) {
				this.modelBounds = null;
				this.modelSphere = null;
				return null;
			}

			this.modelBounds = bounds.clone();
			this.modelSphere = bounds.getBoundingSphere(new THREE.Sphere());
			return this.modelSphere;
		}

		_getModelSphere() {
			if (this.modelSphere) return this.modelSphere;
			if (!this.modelGroup) return null;
			return this._cacheModelBounds(this.modelGroup);
		}

		_updateCameraClipping() {
			const sphere = this._getModelSphere();
			if (!sphere) return false;
			return this._applyCameraClipping(sphere);
		}

		_applyCameraClipping(sphere) {
			if (!this.camera || !sphere || !Number.isFinite(sphere.radius) || sphere.radius <= 0) return false;

			const radius = Math.max(sphere.radius, 0.001);
			const distance = Math.max(this.camera.position.distanceTo(sphere.center), 0.001);
			const nearestSurface = Math.max(distance - radius, 0);
			const minNear = Math.max(radius * 0.0005, distance * 0.00025, 0.001);
			const near = Math.max(nearestSurface > 0 ? nearestSurface * 0.5 : minNear, minNear);
			const far = Math.max(distance + radius * 1.55, near + radius * 2.2, near + 1);
			const needsUpdate =
				Math.abs(this.camera.near - near) > Math.max(near * 0.001, 0.0001) ||
				Math.abs(this.camera.far - far) > Math.max(far * 0.001, 0.0001);

			if (!needsUpdate) return false;

			this.camera.near = near;
			this.camera.far = far;
			this.camera.updateProjectionMatrix();
			return true;
		}

		_updateControlsDistanceLimits(radius, distance) {
			const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
			const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : safeRadius * 3;

			this.controls.minDistance = Math.max(safeRadius * 0.01, 0.001);
			this.controls.maxDistance = Math.max(safeDistance * 50, safeRadius * 80, 1000);
		}

		_getCameraViewSizeAtDistance(distance) {
			return this._getCameraViewSizeForCamera(this.camera, distance);
		}

		_getCameraViewSizeForCamera(camera, distance) {
			if (camera?.isOrthographicCamera) {
				return {
					width: (camera.right - camera.left) / camera.zoom,
					height: (camera.top - camera.bottom) / camera.zoom
				};
			}

			const safeDistance = Math.max(distance, 0.001);
			const aspect = Math.max(this.width / Math.max(this.height, 1), 0.001);
			const fov = camera?.fov || CAMERA_FOV;
			const height = 2 * safeDistance * Math.tan(THREE.MathUtils.degToRad(fov) / 2);

			return {
				width: height * aspect,
				height
			};
		}

		_setOrthographicViewHeight(height) {
			const safeHeight = Math.max(height, 0.001);
			const aspect = Math.max(this.width / Math.max(this.height, 1), 0.001);
			const halfHeight = safeHeight / 2;
			const halfWidth = (safeHeight * aspect) / 2;

			this.orthographicCamera.left = -halfWidth;
			this.orthographicCamera.right = halfWidth;
			this.orthographicCamera.top = halfHeight;
			this.orthographicCamera.bottom = -halfHeight;
			this.orthographicCamera.updateProjectionMatrix();
		}

		_syncOrthographicFromCamera(sourceCamera, target) {
			const distance = Math.max(sourceCamera.position.distanceTo(target), 0.001);
			const viewHeight = sourceCamera.isOrthographicCamera
				? (sourceCamera.top - sourceCamera.bottom) / sourceCamera.zoom
				: this._getCameraViewSizeForCamera(sourceCamera, distance).height;

			this.orthographicCamera.position.copy(sourceCamera.position);
			this.orthographicCamera.up.copy(sourceCamera.up);
			this.orthographicCamera.quaternion.copy(sourceCamera.quaternion);
			this.orthographicCamera.near = Math.max(distance / 100, 0.01);
			this.orthographicCamera.far = Math.max(distance * 100, 1000);
			this.orthographicCamera.zoom = 1;
			this._setOrthographicViewHeight(viewHeight);
		}

		_syncPerspectiveFromCamera(sourceCamera, target) {
			const viewHeight = sourceCamera.isOrthographicCamera
				? (sourceCamera.top - sourceCamera.bottom) / sourceCamera.zoom
				: this._getCameraViewSizeForCamera(sourceCamera, sourceCamera.position.distanceTo(target)).height;
			const distance = Math.max(
				viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2)),
				0.001
			);
			const direction = sourceCamera.position.clone().sub(target).normalize();

			if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();

			this.perspectiveCamera.position.copy(target).add(direction.multiplyScalar(distance));
			this.perspectiveCamera.up.copy(sourceCamera.up);
			this.perspectiveCamera.quaternion.copy(this._getLookAtQuaternion(this.perspectiveCamera.position, target, sourceCamera.up));
			this.perspectiveCamera.near = Math.max(distance / 100, 0.01);
			this.perspectiveCamera.far = Math.max(distance * 100, 1000);
			this.perspectiveCamera.aspect = this.width / Math.max(this.height, 1);
			this.perspectiveCamera.updateProjectionMatrix();
		}

		_getPerspectiveDistanceForViewHeight(viewHeight, fov) {
			return Math.max(
				viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)),
				0.001
			);
		}

		_applyPerspectiveProjectionFrame(transition, fov) {
			const distance = this._getPerspectiveDistanceForViewHeight(transition.viewHeight, fov);

			this.perspectiveCamera.fov = fov;
			this.perspectiveCamera.aspect = this.width / Math.max(this.height, 1);
			this.perspectiveCamera.position
				.copy(transition.target)
				.add(transition.direction.clone().multiplyScalar(distance));
			this.perspectiveCamera.up.copy(transition.up);
			this.perspectiveCamera.quaternion.copy(
				this._getLookAtQuaternion(this.perspectiveCamera.position, transition.target, transition.up)
			);
			this.perspectiveCamera.near = Math.max(distance / 100, 0.01);
			this.perspectiveCamera.far = Math.max(distance * 100, 1000);
			this.perspectiveCamera.updateProjectionMatrix();
			this.camera = this.perspectiveCamera;
			this.controls.object = this.camera;
			this.controls.target.copy(transition.target);
			this._updateControlsDistanceLimits(this.modelGroup ? this._getObjectRadius(this.modelGroup) : 1, distance);
		}

		_updateProjectionTransition(now = performance.now()) {
			if (!this.projectionTransition) return false;

			const transition = this.projectionTransition;
			const rawProgress = Math.min(1, Math.max(0, (now - transition.startedAt) / transition.duration));
			const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
			const fov = THREE.MathUtils.lerp(transition.startFov, transition.endFov, progress);

			this._applyPerspectiveProjectionFrame(transition, fov);

			if (rawProgress >= 1) {
				this._completeProjectionTransition();
			}

			this.needsRender = true;
			return true;
		}

		_syncControlsToActiveCamera(target = this.controls.target) {
			this.controls.object = this.camera;
			this.controls.target.copy(target);
			this.controls.target0.copy(target);
			this.controls.position0.copy(this.camera.position);
			this.controls.up0.copy(this.camera.up);
			this.controls.zoom0 = this.camera.zoom;
			this.controls.update();
		}

		_completeProjectionTransition() {
			if (!this.projectionTransition) return false;

			const transition = this.projectionTransition;
			this._applyPerspectiveProjectionFrame(transition, transition.endFov);

			if (transition.mode === 'orthographic') {
				this._syncOrthographicFromCamera(this.perspectiveCamera, transition.target);
				this.camera = this.orthographicCamera;
			} else {
				this.camera = this.perspectiveCamera;
			}

			this.projectionMode = transition.mode;
			this.projectionTransition = null;
			this._syncControlsToActiveCamera(transition.target);
			this.needsRender = true;
			return true;
		}

		_cancelProjectionTransition() {
			this.projectionTransition = null;
		}

		_updateActiveCameraProjection() {
			if (!this.camera) return;

			if (this.camera.isPerspectiveCamera) {
				this.camera.aspect = this.width / Math.max(this.height, 1);
				this.camera.updateProjectionMatrix();
				return;
			}

			const visibleHeight = (this.camera.top - this.camera.bottom) / this.camera.zoom;
			this._setOrthographicViewHeight(visibleHeight * this.camera.zoom);
		}

		_getObjectCenter(object3D) {
			const bounds = this._getObjectBounds(object3D);
			const center = new THREE.Vector3();
			if (!bounds.isEmpty()) {
				bounds.getCenter(center);
			}
			return center;
		}

		_getObjectRadius(object3D) {
			const bounds = this._getObjectBounds(object3D);
			const sphere = new THREE.Sphere();
			if (!bounds.isEmpty()) {
				bounds.getBoundingSphere(sphere);
			}
			return Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
		}

		_getObjectBounds(object3D) {
			const bounds = new THREE.Box3();
			const geometryBounds = new THREE.Box3();

			object3D.updateWorldMatrix(true, true);
			object3D.traverse((object) => {
				if (object.userData?.isExactSkeletonEdge || object.userData?.isSelectionOutline || !object.geometry) return;
				if (!object.isMesh && !object.isLine && !object.isLineSegments && !object.isPoints) return;

				const position = object.geometry.getAttribute?.('position');
				if (!position) return;

				if (!object.geometry.boundingBox) {
					object.geometry.computeBoundingBox();
				}

				if (!object.geometry.boundingBox || object.geometry.boundingBox.isEmpty()) return;

				geometryBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
				bounds.union(geometryBounds);
			});

			return bounds;
		}

		_setCameraPose(target, offset, up) {
			const position = target.clone().add(offset);

			this.camera.position.copy(position);
			this.camera.up.copy(up);
			this.camera.quaternion.copy(this._getLookAtQuaternion(position, target, up));
		}

		_getLookAtQuaternion(position, target, up) {
			const rotationMatrix = new THREE.Matrix4();
			rotationMatrix.lookAt(position, target, up);
			return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
		}

		_startCameraTransition({ position, target, quaternion, up }) {
			const startPosition = this.camera.position.clone();
			const startTarget = this.controls.target.clone();
			const startQuaternion = this.camera.quaternion.clone();
			const startUp = this.camera.up.clone();

			if (
				startPosition.distanceToSquared(position) < 0.000001 &&
				startTarget.distanceToSquared(target) < 0.000001 &&
				startQuaternion.angleTo(quaternion) < 0.0001
			) {
				this.camera.position.copy(position);
				this.controls.target.copy(target);
				this.camera.up.copy(up);
				this.camera.quaternion.copy(quaternion);
				this.controls.update();
				this.needsRender = true;
				return;
			}

			this.cameraTransition = {
				startedAt: performance.now(),
				duration: VIEW_CUBE_TRANSITION_DURATION,
				startPosition,
				endPosition: position.clone(),
				startTarget,
				endTarget: target.clone(),
				startDistance: Math.max(startPosition.distanceTo(startTarget), 0.001),
				endDistance: Math.max(position.distanceTo(target), 0.001),
				startQuaternion,
				endQuaternion: quaternion.clone(),
				startUp,
				endUp: up.clone()
			};
			this.needsRender = true;
		}

		_updateCameraTransition(now = performance.now()) {
			if (!this.cameraTransition) return false;

			const transition = this.cameraTransition;
			const rawProgress = Math.min(1, Math.max(0, (now - transition.startedAt) / transition.duration));
			const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);

			this.controls.target.copy(transition.startTarget).lerp(transition.endTarget, progress);
			this.camera.quaternion.copy(transition.startQuaternion).slerp(transition.endQuaternion, progress);
			const distance = THREE.MathUtils.lerp(transition.startDistance, transition.endDistance, progress);
			const orbitDirection = new THREE.Vector3(0, 0, 1)
				.applyQuaternion(this.camera.quaternion)
				.normalize();
			this.camera.position.copy(this.controls.target).add(orbitDirection.multiplyScalar(distance));
			this.camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize());

			if (rawProgress >= 1) {
				this.camera.position.copy(transition.endPosition);
				this.controls.target.copy(transition.endTarget);
				this.camera.up.copy(transition.endUp);
				this.camera.quaternion.copy(transition.endQuaternion);
				this.cameraTransition = null;
				this.controls.update();
			}

			this.needsRender = true;
			return true;
		}

		_cancelCameraTransition() {
			this.cameraTransition = null;
		}

		_applyDisplayMode() {
			if (!this.modelGroup) return;

			const state = this.displayState || {};
			const solidMode = Boolean(state.solid);
			const skeletonMode = Boolean(state.skeleton);
			const ghostMode = Boolean(state.ghost);
			const focusMode = this.focusMeshIds?.size > 0;
			const exactSkeletonActive = skeletonMode && this.exactSkeletonReady;

			this.modelGroup.traverse((object) => {
				if (object.userData?.isExactSkeletonEdge) {
					const sourceMeshId = object.userData.sourceMeshId || object.parent?.uuid;
					const focusOwner = focusMode && this.focusSelectionSkeleton && this.focusMeshIds.has(sourceMeshId);
					object.visible = focusMode ? focusOwner : exactSkeletonActive && !ghostMode;
					const materials = Array.isArray(object.material) ? object.material : [object.material];
					for (const material of materials) {
						if (!material) continue;
						material.depthTest = focusMode ? true : solidMode && !ghostMode;
						material.depthWrite = false;
						material.needsUpdate = true;
					}
					return;
				}

				if (!object.isMesh || !object.material) return;

				const focused = focusMode && this.focusMeshIds.has(object.uuid);
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					material.wireframe = false;
					material.visible = true;
					if (focusMode) {
						material.transparent = !focused;
						material.opacity = focused ? 1 : 0.22;
						material.depthTest = true;
						material.depthWrite = focused;
					} else {
						material.transparent = ghostMode && solidMode;
						material.opacity = ghostMode && solidMode ? 0.45 : 1;
						material.depthTest = true;
						material.depthWrite = solidMode && !ghostMode;
					}
					this._applyMaterialBackfaceCulling(material);
					this._applyMaterialVertexColors(material);
					material.needsUpdate = true;
				}
			});
		}

		_applyBackfaceCulling() {
			if (!this.modelGroup) return;

			this.modelGroup.traverse((object) => {
				if (!object.isMesh || !object.material || object.userData?.isExactSkeletonEdge) return;
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					this._applyMaterialBackfaceCulling(material);
				}
			});
		}

		_applyMaterialBackfaceCulling(material) {
			if (!material) return;
			if (!material.userData) material.userData = {};
			if (material.userData.baseSide === undefined) {
				material.userData.baseSide = material.side ?? THREE.FrontSide;
			}

			material.side = this.backfaceCulling ? THREE.FrontSide : material.userData.baseSide;
			material.needsUpdate = true;
		}

		_applyVertexColorsEnabled() {
			if (!this.modelGroup) return;

			this.modelGroup.traverse((object) => {
				if (!object.isMesh || !object.material || object.userData?.isExactSkeletonEdge) return;
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					this._applyMaterialVertexColors(material);
				}
			});
		}

		_applyMaterialVertexColors(material) {
			if (!material) return;
			if (!material.userData) material.userData = {};
			if (material.userData.baseVertexColors === undefined) {
				material.userData.baseVertexColors = Boolean(material.vertexColors);
			}

			material.vertexColors = this.vertexColorsEnabled && Boolean(material.userData.baseVertexColors);
			material.needsUpdate = true;
		}

		_clearExactSkeleton() {
			if (!this.modelGroup) return;

			const skeletonObjects = [];
			this.modelGroup.traverse((object) => {
				if (object.userData?.isExactSkeletonEdge) skeletonObjects.push(object);
			});

			for (const object of skeletonObjects) {
				object.parent?.remove(object);
				object.geometry?.dispose();
			}

			this.exactSkeletonReady = false;
		}

		_initScene() {
			// Инициализация сцены
			this.scene = new THREE.Scene();
			this._initRenderer();
			this._updateSceneBackground();
			this._initCamera();
			this._initControls();
			this._initLight();
			this._initSsaoPass();
			this._initGpuSkeletonPass();
			this._initViewCube();
			this._initAxesHelper();
			this._initMeshPicking();
			// this.updateScene();
			this._startLoop();
		}

		_initRenderer() {
			//Инициализация рендерера
			this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
			this.renderer.setPixelRatio(VIEWER_RENDER_SCALE);
			this.renderer.outputColorSpace = THREE.SRGBColorSpace;
			this.renderer.toneMapping = THREE.NoToneMapping;
			// this.renderer.setSize(this.width, this.height);
			this.renderer.setClearColor(VIEWER_BACKGROUND_STOPS.edge, 1);

			//adding canvas to viewZone DOM element
			// rendererDomElement.style.borderRadius = borderRadius;
			this.viewer.appendChild(this.renderer.domElement);
		}

		_updateSceneBackground() {
			if (!this.scene) return;

			const nextTexture = this._createBackgroundTexture();
			const previousTexture = this.backgroundTexture;
			this.backgroundTexture = nextTexture;
			this.scene.background = nextTexture;
			previousTexture?.dispose?.();
		}

		_createBackgroundTexture() {
			const pixelRatio = this.renderer?.getPixelRatio?.() || 1;
			const width = Math.max(2, Math.round((this.width || 2) * pixelRatio));
			const height = Math.max(2, Math.round((this.height || 2) * pixelRatio));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const context = canvas.getContext('2d');
			const centerX = width * 0.5;
			const centerY = height * 0.42;
			const maxRadius = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY));
			const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
			gradient.addColorStop(0, VIEWER_BACKGROUND_STOPS.center);
			gradient.addColorStop(0.48, VIEWER_BACKGROUND_STOPS.mid);
			gradient.addColorStop(1, VIEWER_BACKGROUND_STOPS.edge);
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);

			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.minFilter = THREE.LinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.generateMipmaps = false;
			return texture;
		}

		_initCamera() {
			// Инициализщация камеры
			this.perspectiveCamera = new THREE.PerspectiveCamera(CAMERA_FOV, this.width / this.height, 0.1, 1000);
			this.orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
			this.camera = this.perspectiveCamera;
			this.projectionMode = DEFAULT_PROJECTION_MODE;
			const pose = this._getViewPose(DEFAULT_CAMERA_VIEW, 5, DEFAULT_VIEW_CUBE_VIEW);
			this._setCameraPose(new THREE.Vector3(0, 0, 0), pose.offset, pose.up);
			this._syncOrthographicFromCamera(this.camera, new THREE.Vector3(0, 0, 0));
		}

		_initControls() {
			// Инициализация контроллера управления
			this.controls = new TrackballControls(this.camera, this.viewer);
			this.controls.enabled = true;
			this.controls.rotateSpeed = 2;
			this.controls.panSpeed = 0.6;
			this.controls.maxDistance = 800;
			this.controls.minDistance = 1;
			this.controls.target = new THREE.Vector3(0, 0, 0);
			this.controls.addEventListener('start', () => {
				this._completeProjectionTransition();
				this._cancelCameraTransition();
				this.viewCubePrimaryFaceSnapView = '';
			});
			this.controls.addEventListener('change', () => {
				this.needsRender = true;
			});
			this.onControlsPointerDown = () => {
				this._syncControlsScreen();
			};
			this.viewer.addEventListener('pointerdown', this.onControlsPointerDown, true);
			this._initCadPanControls();
		}

		_syncControlsScreen() {
			this.controls?.handleResize?.();
		}

		_initCadPanControls() {
			this.onCadPanPointerDown = (event) => {
				if (!this.controls?.enabled || event.pointerType === 'touch') return;

				const isMiddleDrag = event.button === 1;
				const isShiftDrag = event.shiftKey && event.button === 0;
				if (!isMiddleDrag && !isShiftDrag) return;

				event.preventDefault();
				event.stopImmediatePropagation();

				this.cadPanActive = true;
				this.cadPanPointerId = event.pointerId;
				this.cadPanLast.set(event.clientX, event.clientY);
				this.viewer.setPointerCapture?.(event.pointerId);
			};

			this.onCadPanPointerMove = (event) => {
				if (!this.cadPanActive || event.pointerId !== this.cadPanPointerId) return;

				event.preventDefault();
				event.stopImmediatePropagation();
				this._panCameraByPixels(event.clientX - this.cadPanLast.x, event.clientY - this.cadPanLast.y);
				this.cadPanLast.set(event.clientX, event.clientY);
			};

			this.onCadPanPointerUp = (event) => {
				if (!this.cadPanActive || event.pointerId !== this.cadPanPointerId) return;

				event.preventDefault();
				event.stopImmediatePropagation();
				this.cadPanActive = false;
				this.cadPanPointerId = null;
				this.viewer.releasePointerCapture?.(event.pointerId);
			};

			this.onCadPanAuxClick = (event) => {
				if (event.button !== 1) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};

			this.viewer.addEventListener('pointerdown', this.onCadPanPointerDown, true);
			this.viewer.addEventListener('pointermove', this.onCadPanPointerMove, true);
			this.viewer.addEventListener('pointerup', this.onCadPanPointerUp, true);
			this.viewer.addEventListener('pointercancel', this.onCadPanPointerUp, true);
			this.viewer.addEventListener('auxclick', this.onCadPanAuxClick, true);
		}

		_initViewCube() {
			const viewCube = createViewCube();

			this.viewCubeScene = new THREE.Scene();
			this.viewCubeCamera = new THREE.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 20);
			this.viewCubeGroup = viewCube.group;
			this.viewCubeMesh = viewCube.group;
			this.viewCubeEdges = viewCube.outline;
			this.viewCubeHitTargets = viewCube.hitTargets;
			this.viewCubeScene.add(this.viewCubeGroup);
			this.viewCubeScene.add(new THREE.AmbientLight(0xffffff, 2.4));
			this.viewCubeLight = new THREE.DirectionalLight(0xffffff, 2.2);
			this.viewCubeScene.add(this.viewCubeLight);

			this.onViewCubePointerDown = (event) => {
				if (!this.modelGroup || event.button !== 0) return;

				const hit = this._getViewCubeHit(event);
				if (!hit) return;

				const cubeView = hit.object?.userData?.viewCubeView || getViewFromViewCubeNormal(hit.face?.normal);
				const cameraView = getCameraViewFromViewCubeView(cubeView);
				if (!cubeView || !cameraView) return;
				const primaryFace = isPrimaryViewCubeView(cubeView);
				const rollMode =
					primaryFace && this.viewCubePrimaryFaceSnapView !== cubeView ? 'nearest' : 'canonical';

				this.viewCubePrimaryFaceSnapView = primaryFace ? cubeView : '';

				event.preventDefault();
				event.stopImmediatePropagation();
				this.setView(cameraView, { rollView: cubeView, rollMode });
			};

			this.onViewCubePointerMove = (event) => {
				const hit = this.modelGroup ? this._getViewCubeHit(event) : null;
				const hoverKey = this._getViewCubeHoverKey(hit);

				if (hoverKey !== this.viewCubeHoveredObject) {
					this._setViewCubeHover(hoverKey);
					this.needsRender = true;
				}

				this.viewer.style.cursor = hit ? 'pointer' : '';
			};

			this.onViewCubePointerLeave = () => {
				this.viewer.style.cursor = '';
				this._setViewCubeHover(null);
				this.needsRender = true;
			};

			this.viewer.addEventListener('pointerdown', this.onViewCubePointerDown, true);
			this.viewer.addEventListener('pointermove', this.onViewCubePointerMove, true);
			this.viewer.addEventListener('pointerleave', this.onViewCubePointerLeave, true);
		}

		_initAxesHelper() {
			this.axesScene = new THREE.Scene();
			this.axesCamera = new THREE.OrthographicCamera(
				-AXES_HELPER_VIEW_EXTENT,
				AXES_HELPER_VIEW_EXTENT,
				AXES_HELPER_VIEW_EXTENT,
				-AXES_HELPER_VIEW_EXTENT,
				0.1,
				20
			);
			this.axesGroup = createAxesGizmo();
			this.axesScene.add(this.axesGroup);
		}

		_initMeshPicking() {
			this.onMeshPointerDown = (event) => {
				if (!this.modelGroup || event.button !== 0 || this._getViewCubeHit(event)) return;

				this.meshPointerLast = { x: event.clientX, y: event.clientY };
				this.meshPointerDown = {
					x: event.clientX,
					y: event.clientY,
					time: performance.now()
				};
			};

			this.onMeshPointerUp = (event) => {
				if (!this.modelGroup || event.button !== 0 || !this.meshPointerDown) return;
				if (this._getViewCubeHit(event)) return;
				this.meshPointerLast = { x: event.clientX, y: event.clientY };

				const deltaX = event.clientX - this.meshPointerDown.x;
				const deltaY = event.clientY - this.meshPointerDown.y;
				this.meshPointerDown = null;
				if (Math.hypot(deltaX, deltaY) > 4) return;

				const mesh = this._pickMeshFromEvent(event);
				if (!mesh) return;

				this.hoveredMesh = mesh;
				this.selectMesh(mesh.uuid);
				dispatch('meshselect', {
					meshId: mesh.uuid,
					name: getObjectDisplayName(mesh, 'Mesh')
				});
			};

			this.onMeshPointerMove = (event) => {
				if (!this.modelGroup) {
					this.hoveredMesh = null;
					this.meshPointerLast = null;
					return;
				}

				this.meshPointerLast = { x: event.clientX, y: event.clientY };
				this.hoveredMesh = null;
			};

			this.onMeshPointerLeave = () => {
				this.hoveredMesh = null;
				this.meshPointerLast = null;
				this.viewer.style.cursor = '';
			};

			this.onMeshKeyDown = (event) => {
				if (event.key !== 'Tab') return;

				const targetMesh = event.shiftKey
					? this._pickMeshFromLastPointer({ includeHidden: true, preferHidden: true }) || this._findMeshById(this.selectedMeshId)
					: this.hoveredMesh || this._pickMeshFromLastPointer() || this._findMeshById(this.selectedMeshId);
				if (!targetMesh) return;

				const nextVisible = event.shiftKey ? true : false;
				if (this._isObjectEffectivelyVisible(targetMesh) === nextVisible) return;

				event.preventDefault();
				event.stopImmediatePropagation();
				this.clearMeshFocus();
				this.setMeshVisibility(targetMesh.uuid, nextVisible, { emit: true });
			};

			this.viewer.addEventListener('pointerdown', this.onMeshPointerDown, true);
			this.viewer.addEventListener('pointerup', this.onMeshPointerUp, true);
			this.viewer.addEventListener('pointermove', this.onMeshPointerMove, true);
			this.viewer.addEventListener('pointerleave', this.onMeshPointerLeave, true);
			window.addEventListener('keydown', this.onMeshKeyDown, true);
		}

		_pickMeshFromEvent(event) {
			return this._pickMeshFromPointer(event.clientX, event.clientY);
		}

		_pickMeshFromLastPointer(options = {}) {
			if (!this.meshPointerLast) return null;
			return this._pickMeshFromPointer(this.meshPointerLast.x, this.meshPointerLast.y, options);
		}

		_pickMeshFromPointer(clientX, clientY, { includeHidden = false, preferHidden = false } = {}) {
			const meshes = includeHidden ? this._getModelMeshes({ includeHidden: true }) : this._getVisibleModelMeshes();
			if (!meshes.length) return null;

			const rect = this.viewer.getBoundingClientRect();
			const hiddenMeshIds = new Set(
				includeHidden
					? meshes.filter((mesh) => !this._isObjectEffectivelyVisible(mesh)).map((mesh) => mesh.uuid)
					: []
			);
			const previousVisibility = [];

			if (includeHidden) {
				for (const mesh of meshes) {
					previousVisibility.push([mesh, mesh.visible]);
					mesh.visible = true;
				}
			}

			this.meshPointer.set(
				((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
				-(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1)
			);
			this.camera.updateMatrixWorld(true);
			this.modelGroup.updateWorldMatrix(true, true);
			this.meshRaycaster.setFromCamera(this.meshPointer, this.camera);

			const hits = this.meshRaycaster.intersectObjects(meshes, false);

			for (const [mesh, visible] of previousVisibility) {
				mesh.visible = visible;
			}

			if (preferHidden) {
				const hiddenHit =
					hits.find((hit) => hiddenMeshIds.has(hit.object?.uuid))?.object ||
					this._pickProjectedMeshFromPointer(clientX, clientY, meshes, { preferHidden, hiddenMeshIds });
				return hiddenHit;
			}

			const pickedMesh =
				hits[0]?.object || this._pickProjectedMeshFromPointer(clientX, clientY, meshes, { hiddenMeshIds });
			return pickedMesh;
		}

		_pickProjectedMeshFromPointer(clientX, clientY, meshes, { preferHidden = false, hiddenMeshIds = new Set() } = {}) {
			const rect = this.viewer.getBoundingClientRect();
			const localX = clientX - rect.left;
			const localY = clientY - rect.top;
			const margin = 3;
			const point = new THREE.Vector3();
			const center = new THREE.Vector3();
			const projectedCenter = new THREE.Vector3();
			const candidates = [];

			for (const mesh of meshes) {
				if (!mesh?.geometry?.getAttribute?.('position')) continue;
				if (preferHidden && !hiddenMeshIds.has(mesh.uuid)) continue;
				if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
				const box = mesh.geometry.boundingBox;
				if (!box || box.isEmpty()) continue;

				let minX = Infinity;
				let minY = Infinity;
				let maxX = -Infinity;
				let maxY = -Infinity;

				for (const x of [box.min.x, box.max.x]) {
					for (const y of [box.min.y, box.max.y]) {
						for (const z of [box.min.z, box.max.z]) {
							point.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(this.camera);
							if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
							minX = Math.min(minX, (point.x * 0.5 + 0.5) * rect.width);
							maxX = Math.max(maxX, (point.x * 0.5 + 0.5) * rect.width);
							minY = Math.min(minY, (-point.y * 0.5 + 0.5) * rect.height);
							maxY = Math.max(maxY, (-point.y * 0.5 + 0.5) * rect.height);
						}
					}
				}

				if (
					localX < minX - margin ||
					localX > maxX + margin ||
					localY < minY - margin ||
					localY > maxY + margin
				) {
					continue;
				}

				box.getCenter(center);
				projectedCenter.copy(center).applyMatrix4(mesh.matrixWorld).project(this.camera);
				const width = Math.max(maxX - minX, 1);
				const height = Math.max(maxY - minY, 1);
				const centerDistance = Math.hypot(
					localX - (projectedCenter.x * 0.5 + 0.5) * rect.width,
					localY - (-projectedCenter.y * 0.5 + 0.5) * rect.height
				);
				candidates.push({
					mesh,
					depth: projectedCenter.z,
					area: width * height,
					centerDistance
				});
			}

			candidates.sort((a, b) => a.depth - b.depth || a.area - b.area || a.centerDistance - b.centerDistance);
			return candidates[0]?.mesh || null;
		}

		_panCameraByPixels(deltaX, deltaY) {
			this._completeProjectionTransition();
			this._cancelCameraTransition();
			const width = Math.max(this.viewer.clientWidth, 1);
			const height = Math.max(this.viewer.clientHeight, 1);

			this.cadPanDelta.set(deltaX / width, deltaY / height);
			if (this.cadPanDelta.lengthSq() === 0) return;

			this.cadPanEye.copy(this.camera.position).sub(this.controls.target);
			const distance = Math.max(this.cadPanEye.length(), 1);
			const { width: horizontalWorldSize, height: verticalWorldSize } =
				this._getCameraViewSizeAtDistance(distance);

			this.camera.updateMatrixWorld();
			this.cadPanRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
			this.cadPanUp.setFromMatrixColumn(this.camera.matrixWorld, 1);

			this.cadPanOffset
				.copy(this.cadPanRight)
				.multiplyScalar(-this.cadPanDelta.x * horizontalWorldSize * this.controls.panSpeed)
				.addScaledVector(this.cadPanUp, this.cadPanDelta.y * verticalWorldSize * this.controls.panSpeed);
			this.camera.position.add(this.cadPanOffset);
			this.controls.target.add(this.cadPanOffset);
			this.controls.update();
			this.needsRender = true;
		}

		dispose() {
			this.viewer?.removeEventListener('pointerdown', this.onCadPanPointerDown, true);
			this.viewer?.removeEventListener('pointerdown', this.onControlsPointerDown, true);
			this.viewer?.removeEventListener('pointermove', this.onCadPanPointerMove, true);
			this.viewer?.removeEventListener('pointerup', this.onCadPanPointerUp, true);
			this.viewer?.removeEventListener('pointercancel', this.onCadPanPointerUp, true);
			this.viewer?.removeEventListener('auxclick', this.onCadPanAuxClick, true);
			this.viewer?.removeEventListener('pointerdown', this.onViewCubePointerDown, true);
			this.viewer?.removeEventListener('pointermove', this.onViewCubePointerMove, true);
			this.viewer?.removeEventListener('pointerleave', this.onViewCubePointerLeave, true);
			this.viewer?.removeEventListener('pointerdown', this.onMeshPointerDown, true);
			this.viewer?.removeEventListener('pointerup', this.onMeshPointerUp, true);
			this.viewer?.removeEventListener('pointermove', this.onMeshPointerMove, true);
			this.viewer?.removeEventListener('pointerleave', this.onMeshPointerLeave, true);
			window.removeEventListener('keydown', this.onMeshKeyDown, true);
			this._clearSelectionOutline();
			this.selectionOutlineMaterial?.dispose?.();
			this._disposeViewCube();
			this._disposeAxesHelper();
			this.backgroundTexture?.dispose?.();
			this.ssaoDepthPrepassMaterial?.dispose?.();
			this.ssaoPass?.dispose?.();
			this.ssaoOutputPass?.dispose?.();
			this.ssaoComposer?.dispose?.();
			this.controls?.dispose();
			this.renderer?.dispose();
		}

		_initLight() {
			// Инициализация света
			this.directionalLight = new THREE.DirectionalLight(0xffffff, 2.35);
			this.directionalLight.position.set(3, -4, 6);
			this.ambiantLight = new THREE.AmbientLight(0x606060, 5.2);
		}

		_initSsaoPass() {
			try {
				const width = Math.max(1, this.width);
				const height = Math.max(1, this.height);

				this.ssaoComposer = new EffectComposer(
					this.renderer,
					this._createSsaoComposerRenderTarget(width, height)
				);
				this.ssaoRenderPass = new RenderPass(this.scene, this.camera, null, null, 1);
				this.ssaoPass = new GTAOPass(
					this.scene,
					this.camera,
					width,
					height,
					undefined,
					this._createGtaoParameters(),
					this._createGtaoDenoiseParameters()
				);
				this.ssaoPass.output = GTAOPass.OUTPUT.Default;
				this._disableGtaoClipBox();
				this._patchGtaoBackgroundDepthHandling();
				this._patchGtaoGBufferBackground();
				this.ssaoOutputPass = new OutputPass();

				this.ssaoComposer.addPass(this.ssaoRenderPass);
				this.ssaoComposer.addPass(this.ssaoPass);
				this.ssaoComposer.addPass(this.ssaoOutputPass);
				this.ssaoComposer.setSize(width, height);
				this._applySsaoSettings();

				this.ssaoDepthPrepassMaterial = new THREE.MeshBasicMaterial({
					colorWrite: false,
					depthWrite: true,
					depthTest: true,
					blending: THREE.NoBlending
				});
			} catch (error) {
				this.ssaoEnabled = false;
				console.warn('GTAO is not available in this browser context:', error);
			}
		}

		_createGtaoParameters() {
			return {
				radius: 0.25,
				distanceExponent: 1,
				thickness: 1,
				distanceFallOff: 1,
				scale: this.ssaoSettings.power,
				samples: GTAO_SAMPLES,
				screenSpaceRadius: false
			};
		}

		_createGtaoDenoiseParameters() {
			return {
				lumaPhi: 10,
				depthPhi: 2.4,
				normalPhi: 3,
				radius: 5,
				radiusExponent: 1.7,
				rings: 2,
				samples: GTAO_DENOISE_SAMPLES
			};
		}

		_disableGtaoClipBox() {
			if (!this.ssaoPass?.gtaoMaterial) return;

			this.ssaoPass.setSceneClipBox?.(null);
			if (this.ssaoPass.gtaoMaterial.defines.SCENE_CLIP_BOX !== 0) {
				this.ssaoPass.gtaoMaterial.defines.SCENE_CLIP_BOX = 0;
				this.ssaoPass.gtaoMaterial.needsUpdate = true;
			}
		}

		_patchGtaoBackgroundDepthHandling() {
			const backgroundDepthLimit = '0.999999';
			const gtaoMaterial = this.ssaoPass?.gtaoMaterial;
			const pdMaterial = this.ssaoPass?.pdMaterial;

			if (gtaoMaterial && !gtaoMaterial.userData?.backgroundDepthPatched) {
				gtaoMaterial.fragmentShader = gtaoMaterial.fragmentShader.replace(
					'if (depth >= 1.0) {',
					`if (depth >= ${backgroundDepthLimit}) {`
				);
				gtaoMaterial.userData.backgroundDepthPatched = true;
				gtaoMaterial.needsUpdate = true;
			}

			if (pdMaterial && !pdMaterial.userData?.backgroundDepthPatched) {
				pdMaterial.fragmentShader = pdMaterial.fragmentShader
					.replace(
						'float sampleDepth = getDepth(sampleUv);\n\t\t\tvec3 sampleNormal = getViewNormal(sampleUv);',
						`float sampleDepth = getDepth(sampleUv);\n\t\t\tif (sampleDepth >= ${backgroundDepthLimit}) return;\n\t\t\tvec3 sampleNormal = getViewNormal(sampleUv);`
					)
					.replace(
						'if (depth == 1. || dot(viewNormal, viewNormal) == 0.) {',
						`if (depth >= ${backgroundDepthLimit} || dot(viewNormal, viewNormal) == 0.) {`
					);
				pdMaterial.userData.backgroundDepthPatched = true;
				pdMaterial.needsUpdate = true;
			}
		}

		_patchGtaoGBufferBackground() {
			if (!this.ssaoPass || this.ssaoPass.userData?.gBufferBackgroundPatched) return;

			const gtaoPass = this.ssaoPass;
			const renderOverride = gtaoPass.renderOverride.bind(gtaoPass);

			gtaoPass.renderOverride = (renderer, overrideMaterial, renderTarget, clearColor, clearAlpha) => {
				const previousBackground = gtaoPass.scene.background;
				gtaoPass.scene.background = null;
				try {
					renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha);
				} finally {
					gtaoPass.scene.background = previousBackground;
				}
			};
			gtaoPass.userData = {
				...(gtaoPass.userData || {}),
				gBufferBackgroundPatched: true
			};
		}

		_createSsaoComposerRenderTarget(width, height) {
			const samples = this._getComposerSamples();
			const renderTarget = new THREE.WebGLRenderTarget(width, height, {
				type: THREE.HalfFloatType,
				samples
			});
			renderTarget.texture.name = 'GTAOComposer.msaa';
			return renderTarget;
		}

		_getComposerSamples() {
			if (!this.renderer?.capabilities?.isWebGL2) return 0;
			return Math.min(4, this.renderer.capabilities.maxSamples || 0);
		}

		_resizeSsaoPass() {
			if (!this.ssaoComposer || !this.ssaoPass) return;

			const width = Math.max(1, this.width);
			const height = Math.max(1, this.height);
			this.ssaoComposer.setSize(width, height);
			this._syncSsaoPassCamera();
			this._updateSsaoParameters();
		}

		_syncSsaoPassCamera() {
			if (!this.ssaoPass || !this.ssaoRenderPass || !this.camera) return;

			this.ssaoRenderPass.camera = this.camera;
			this.ssaoPass.camera = this.camera;
			const perspectiveDefine = this.camera.isPerspectiveCamera ? 1 : 0;
			if (this.ssaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== perspectiveDefine) {
				this.ssaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = perspectiveDefine;
				this.ssaoPass.gtaoMaterial.needsUpdate = true;
			}
			if (this.ssaoPass.depthRenderMaterial.defines.PERSPECTIVE_CAMERA !== perspectiveDefine) {
				this.ssaoPass.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = perspectiveDefine;
				this.ssaoPass.depthRenderMaterial.needsUpdate = true;
			}
			this.ssaoPass.depthRenderMaterial.uniforms.cameraNear.value = this.camera.near;
			this.ssaoPass.depthRenderMaterial.uniforms.cameraFar.value = this.camera.far;
			this._disableGtaoClipBox();
		}

		_applySsaoSettings() {
			this.ssaoEnabled = Boolean(this.ssaoSettings.enabled);
			if (!this.ssaoPass?.gtaoMaterial) return;

			this.ssaoPass.blendIntensity = this.ssaoSettings.strength;
			this.ssaoPass.updateGtaoMaterial({
				scale: this.ssaoSettings.power
			});
		}

		_updateSsaoParameters() {
			if (!this.ssaoPass) return;

			const radius = this.modelGroup ? this._getObjectRadius(this.modelGroup) : 1;
			const aoRadius = THREE.MathUtils.clamp(radius * this.ssaoSettings.radiusScale, 0.025, 3.2);
			const thickness = THREE.MathUtils.clamp(
				Math.max(radius * this.ssaoSettings.maxDistance, aoRadius * 1.35),
				aoRadius * 0.75,
				Math.max(radius * 0.45, aoRadius * 8)
			);
			const distanceFallOff = THREE.MathUtils.clamp(1.2 - this.ssaoSettings.minDistance * 6, 0.75, 1.2);

			this.ssaoPass.updateGtaoMaterial({
				radius: aoRadius,
				thickness,
				distanceFallOff,
				distanceExponent: 1,
				scale: this.ssaoSettings.power,
				screenSpaceRadius: false
			});
			this.ssaoPass.updatePdMaterial({
				radius: THREE.MathUtils.clamp(aoRadius * 1.4, 3, 7),
				depthPhi: THREE.MathUtils.clamp(thickness * 0.55, 1.4, 4)
			});
			this._applySsaoSettings();
		}

		_shouldRenderSsao(state, hasModel) {
			return Boolean(
				this.ssaoEnabled &&
					this.ssaoComposer &&
					this.ssaoPass &&
					hasModel &&
					state.solid &&
					!state.ghost
			);
		}

		_renderSsaoBase() {
			if (!this.ssaoComposer || !this.ssaoPass) {
				this.renderer.render(this.scene, this.camera);
				return false;
			}

			const previousAutoClear = this.renderer.autoClear;

			this.renderer.setRenderTarget(null);
			this._syncSsaoPassCamera();
			this._updateSsaoParameters();
			this.ssaoComposer.render();
			this.renderer.autoClear = previousAutoClear;
			return true;
		}

		_renderSceneWithoutBackground(renderCallback) {
			const previousBackground = this.scene.background;
			this.scene.background = null;
			try {
				return renderCallback();
			} finally {
				this.scene.background = previousBackground;
			}
		}

		_renderBackgroundOnly() {
			const previousOverrideMaterial = this.scene.overrideMaterial;
			const previousAutoClear = this.renderer.autoClear;
			const previousModelVisible = this.modelGroup?.visible;

			if (this.modelGroup) this.modelGroup.visible = false;
			this.scene.overrideMaterial = null;
			this.renderer.autoClear = true;
			this.renderer.render(this.scene, this.camera);

			if (this.modelGroup) this.modelGroup.visible = previousModelVisible;
			this.scene.overrideMaterial = previousOverrideMaterial;
			this.renderer.autoClear = previousAutoClear;
		}

		_renderScreenDepthPrepass() {
			if (!this.ssaoDepthPrepassMaterial || !this.modelGroup) return;

			const previousOverrideMaterial = this.scene.overrideMaterial;
			const previousAutoClear = this.renderer.autoClear;
			const hiddenObjects = [];

			this.scene.traverse((object) => {
				if ((object.isLine || object.isPoints) && object.visible) {
					hiddenObjects.push(object);
					object.visible = false;
				}
			});

			this.scene.overrideMaterial = this.ssaoDepthPrepassMaterial;
			this.renderer.autoClear = false;
			this.renderer.setRenderTarget(null);
			this.renderer.clearDepth();
			this._renderSceneWithoutBackground(() => {
				this.renderer.render(this.scene, this.camera);
			});
			this.scene.overrideMaterial = previousOverrideMaterial;
			this.renderer.autoClear = previousAutoClear;

			for (const object of hiddenObjects) {
				object.visible = true;
			}
		}

		_initGpuSkeletonPass() {
			const { width, height } = this._getGpuSkeletonTargetSize();

			this.edgeRenderTarget = new THREE.WebGLRenderTarget(width, height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				depthBuffer: true,
				stencilBuffer: false
			});
			this.edgeBackRenderTarget = new THREE.WebGLRenderTarget(width, height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				depthBuffer: true,
				stencilBuffer: false
			});
			this.edgeMaskRenderTarget = new THREE.WebGLRenderTarget(width, height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				depthBuffer: false,
				stencilBuffer: false
			});
			this.edgeBackMaskRenderTarget = new THREE.WebGLRenderTarget(width, height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat,
				type: THREE.UnsignedByteType,
				depthBuffer: false,
				stencilBuffer: false
			});

			this.edgeNormalMaterial = new THREE.MeshNormalMaterial({
				side: THREE.FrontSide,
				depthTest: false,
				depthWrite: false,
				blending: THREE.NoBlending
			});
			this.edgeBackNormalMaterial = new THREE.MeshNormalMaterial({
				side: THREE.BackSide,
				depthTest: false,
				depthWrite: false,
				blending: THREE.NoBlending
			});

			this.edgeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
			this.edgeScene = new THREE.Scene();
			this.edgeShaderMaterial = new THREE.ShaderMaterial({
				transparent: true,
				depthTest: false,
				depthWrite: false,
				uniforms: {
					tNormal: { value: this.edgeRenderTarget.texture },
					resolution: { value: new THREE.Vector2(width, height) },
					normalThreshold: { value: 0.22 }
				},
				vertexShader: `
					varying vec2 vUv;

					void main() {
						vUv = uv;
						gl_Position = vec4(position.xy, 0.0, 1.0);
					}
				`,
				fragmentShader: `
					precision highp float;

					uniform sampler2D tNormal;
					uniform vec2 resolution;
					uniform float normalThreshold;

					varying vec2 vUv;

					vec3 unpackNormal(vec3 packedNormal) {
						return normalize(packedNormal * 2.0 - 1.0);
					}

					float sampleEdge(sampler2D normalTexture, vec2 uv, vec2 offset, vec3 centerNormal) {
						vec2 sampleUv = clamp(uv + offset, vec2(0.0), vec2(1.0));
						vec3 samplePackedNormal = texture2D(normalTexture, sampleUv).xyz;
						vec3 sampleNormal = unpackNormal(samplePackedNormal);
						float normalDelta = 1.0 - max(dot(centerNormal, sampleNormal), 0.0);
						float normalEdge = smoothstep(normalThreshold * 0.72, normalThreshold * 1.22, normalDelta);
						float silhouetteEdge = 1.0 - smoothstep(0.0005, 0.003, length(samplePackedNormal));

						return max(normalEdge, silhouetteEdge);
					}

					float layerEdge(sampler2D normalTexture, vec2 uv) {
						vec2 pixel = 1.0 / resolution;
						vec3 centerPackedNormal = texture2D(normalTexture, uv).xyz;

						if (length(centerPackedNormal) < 0.001) {
							return 0.0;
						}

						vec3 centerNormal = unpackNormal(centerPackedNormal);
						float edge = 0.0;

						edge = max(edge, sampleEdge(normalTexture, uv, vec2(pixel.x, 0.0), centerNormal));
						edge = max(edge, sampleEdge(normalTexture, uv, vec2(0.0, pixel.y), centerNormal));

						return edge;
					}

					void main() {
						float edge = layerEdge(tNormal, vUv);
						if (edge < 0.01) {
							discard;
						}

						gl_FragColor = vec4(vec3(1.0), clamp(edge, 0.0, 1.0));
					}
				`
			});
			this.edgeCompositeMaterial = new THREE.ShaderMaterial({
				transparent: true,
				depthTest: false,
				depthWrite: false,
				uniforms: {
					tFrontMask: { value: this.edgeMaskRenderTarget.texture },
					tBackMask: { value: this.edgeBackMaskRenderTarget.texture },
					resolution: { value: new THREE.Vector2(width, height) },
					lineColor: { value: new THREE.Color(0x10151c) },
					antialiasStrength: { value: 0.42 }
				},
				vertexShader: `
					varying vec2 vUv;

					void main() {
						vUv = uv;
						gl_Position = vec4(position.xy, 0.0, 1.0);
					}
				`,
				fragmentShader: `
					precision highp float;

					uniform sampler2D tFrontMask;
					uniform sampler2D tBackMask;
					uniform vec2 resolution;
					uniform vec3 lineColor;
					uniform float antialiasStrength;

					varying vec2 vUv;

					float edgeMask(vec2 uv) {
						vec2 sampleUv = clamp(uv, vec2(0.0), vec2(1.0));
						return max(texture2D(tFrontMask, sampleUv).a, texture2D(tBackMask, sampleUv).a);
					}

					void main() {
						vec2 pixel = 1.0 / resolution;
						float center = edgeMask(vUv);
						float cardinal = 0.0;
						float diagonal = 0.0;

						cardinal = max(cardinal, edgeMask(vUv + vec2(pixel.x, 0.0)));
						cardinal = max(cardinal, edgeMask(vUv - vec2(pixel.x, 0.0)));
						cardinal = max(cardinal, edgeMask(vUv + vec2(0.0, pixel.y)));
						cardinal = max(cardinal, edgeMask(vUv - vec2(0.0, pixel.y)));

						diagonal = max(diagonal, edgeMask(vUv + pixel));
						diagonal = max(diagonal, edgeMask(vUv - pixel));
						diagonal = max(diagonal, edgeMask(vUv + vec2(pixel.x, -pixel.y)));
						diagonal = max(diagonal, edgeMask(vUv + vec2(-pixel.x, pixel.y)));

						float edge = center + (1.0 - center) * max(cardinal * antialiasStrength, diagonal * antialiasStrength * 0.55);
						if (edge < 0.02) {
							discard;
						}

						gl_FragColor = vec4(lineColor, clamp(edge, 0.0, 1.0));
					}
				`
			});

			this.edgeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edgeShaderMaterial);
			this.edgeQuad.frustumCulled = false;
			this.edgeScene.add(this.edgeQuad);
		}

		_getGpuSkeletonTargetSize() {
			const pixelRatio = Math.max(1, this.renderer?.getPixelRatio?.() || 1);
			return {
				width: Math.max(1, Math.round(this.width * pixelRatio)),
				height: Math.max(1, Math.round(this.height * pixelRatio))
			};
		}

		_resizeGpuSkeletonPass() {
			if (
				!this.edgeRenderTarget ||
				!this.edgeBackRenderTarget ||
				!this.edgeMaskRenderTarget ||
				!this.edgeBackMaskRenderTarget ||
				!this.edgeShaderMaterial
			) return;

			const { width, height } = this._getGpuSkeletonTargetSize();
			this.edgeRenderTarget.setSize(width, height);
			this.edgeBackRenderTarget.setSize(width, height);
			this.edgeMaskRenderTarget.setSize(width, height);
			this.edgeBackMaskRenderTarget.setSize(width, height);
			this.edgeShaderMaterial.uniforms.resolution.value.set(width, height);
			this.edgeCompositeMaterial?.uniforms.resolution.value.set(width, height);
		}

		_renderFrame(options = {}) {
			const {
				includeHelpers = true,
				transparentBackground = false,
				useSsao: allowSsao = true
			} = options;
			const state = this.displayState || {};
			const hasModel = Boolean(this.modelGroup);
			const occludeSkeleton = Boolean(state.solid && !state.ghost);
			const useSsao = allowSsao && !transparentBackground && this._shouldRenderSsao(state, hasModel);
			const previousBackground = this.scene.background;
			const previousClearColor = this.renderer.getClearColor(new THREE.Color());
			const previousClearAlpha = this.renderer.getClearAlpha();

			if (hasModel) this._updateCameraClipping();
			this.renderer.setRenderTarget(null);

			if (transparentBackground) {
				this.scene.background = null;
				this.renderer.setClearColor(0x000000, 0);
				this.renderer.clear(true, true, true);
			}

			try {
				if (state.solid || !hasModel) {
					if (useSsao) {
						this._renderSsaoBase();
						if (state.wire) this._renderScreenDepthPrepass();
					} else {
						this.renderer.render(this.scene, this.camera);
					}
				} else {
					if (transparentBackground) {
						this.renderer.setRenderTarget(null);
						this.renderer.clear(true, true, true);
					} else {
						this._renderBackgroundOnly();
					}
				}

				if (state.wire && hasModel) {
					this._renderWireOverlay();
				}

				if (state.skeleton && hasModel) {
					if (this.exactSkeletonReady) {
						if (!state.solid || state.ghost) this._renderExactSkeletonOverlay();
					} else {
						this._renderGpuSkeleton({
							overlay: Boolean(state.solid || state.wire),
							visibleOnly: occludeSkeleton
						});
					}
				}

				if (includeHelpers && hasModel) {
					this._renderViewCube();
					this._renderAxesHelper();
				}
			} finally {
				this.scene.background = previousBackground;
				this.renderer.setClearColor(previousClearColor, previousClearAlpha);
			}
		}

		_renderViewCube() {
			if (!this.viewCubeScene || !this.viewCubeCamera || !this.viewCubeMesh) return;

			const layout = this._getViewCubeLayout(this.width, this.height);
			const previousAutoClear = this.renderer.autoClear;

			this._syncViewCubeCamera();
			this.renderer.setRenderTarget(null);
			this.renderer.autoClear = false;
			this.renderer.setScissorTest(true);
			this.renderer.setViewport(layout.left, layout.bottom, layout.size, layout.size);
			this.renderer.setScissor(layout.left, layout.bottom, layout.size, layout.size);
			this.renderer.clear(false, true, false);
			this.renderer.render(this.viewCubeScene, this.viewCubeCamera);
			this.renderer.setScissorTest(false);
			this.renderer.setViewport(0, 0, this.width, this.height);
			this.renderer.autoClear = previousAutoClear;
		}

		_syncViewCubeCamera() {
			const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
			const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
			const cubeForward = forward.applyQuaternion(VIEW_CUBE_ORIENTATION_CORRECTION).normalize();
			const cubeUp = up.applyQuaternion(VIEW_CUBE_ORIENTATION_CORRECTION).normalize();

			this.viewCubeCamera.position.copy(cubeForward).multiplyScalar(-6);
			this.viewCubeCamera.up.copy(cubeUp);
			this.viewCubeCamera.lookAt(0, 0, 0);
			this.viewCubeCamera.updateMatrixWorld();
			this.viewCubeLight?.position.copy(this.viewCubeCamera.position);
		}

		_getViewCubeLayout(width, height) {
			const shortestSide = Math.max(1, Math.min(width, height));
			const size = Math.round(
				Math.min(VIEW_CUBE_BASE_SIZE, Math.max(VIEW_CUBE_MIN_SIZE, shortestSide * 0.18))
			);
			const margin = Math.round(Math.min(VIEW_CUBE_MARGIN, Math.max(10, shortestSide * 0.03)));

			return {
				size,
				margin,
				left: Math.max(0, width - size - margin),
				top: margin,
				bottom: Math.max(0, height - size - margin)
			};
		}

		_renderAxesHelper() {
			if (!this.axesScene || !this.axesCamera || !this.axesGroup) return;

			const layout = this._getAxesHelperLayout(this.width, this.height);
			const previousAutoClear = this.renderer.autoClear;

			this._syncAxesHelperCamera();
			this.renderer.setRenderTarget(null);
			this.renderer.autoClear = false;
			this.renderer.setScissorTest(true);
			this.renderer.setViewport(layout.left, layout.bottom, layout.size, layout.size);
			this.renderer.setScissor(layout.left, layout.bottom, layout.size, layout.size);
			this.renderer.clear(false, true, false);
			this.renderer.render(this.axesScene, this.axesCamera);
			this.renderer.setScissorTest(false);
			this.renderer.setViewport(0, 0, this.width, this.height);
			this.renderer.autoClear = previousAutoClear;
		}

		_syncAxesHelperCamera() {
			const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
			const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

			this.axesCamera.position.copy(forward).multiplyScalar(-AXES_HELPER_CAMERA_DISTANCE);
			this.axesCamera.up.copy(up);
			this.axesCamera.lookAt(0, 0, 0);
			this.axesCamera.updateMatrixWorld();
		}

		_getAxesHelperLayout(width, height) {
			const shortestSide = Math.max(1, Math.min(width, height));
			const size = Math.round(
				Math.min(AXES_HELPER_BASE_SIZE, Math.max(AXES_HELPER_MIN_SIZE, shortestSide * 0.13))
			);
			const margin = Math.round(Math.min(AXES_HELPER_MARGIN, Math.max(10, shortestSide * 0.025)));

			return {
				size,
				margin,
				left: margin,
				bottom: margin
			};
		}

		_getViewCubeHit(event) {
			if (!this.viewCubeHitTargets?.length || !this.viewCubeCamera) return null;

			const rect = this.viewer.getBoundingClientRect();
			const layout = this._getViewCubeLayout(rect.width, rect.height);
			const pointerX = event.clientX - rect.left;
			const pointerY = event.clientY - rect.top;

			if (
				pointerX < layout.left ||
				pointerX > layout.left + layout.size ||
				pointerY < layout.top ||
				pointerY > layout.top + layout.size
			) {
				return null;
			}

			this._syncViewCubeCamera();
			this.viewCubePointer.set(
				((pointerX - layout.left) / layout.size) * 2 - 1,
				-(((pointerY - layout.top) / layout.size) * 2 - 1)
			);
			this.viewCubeRaycaster.setFromCamera(this.viewCubePointer, this.viewCubeCamera);

			return this.viewCubeRaycaster.intersectObjects(this.viewCubeHitTargets, false)[0] || null;
		}

		_getViewCubeHoverKey(hit) {
			return hit?.face?.materialIndex ?? null;
		}

		_setViewCubeHover(hoverMaterialIndex) {
			this.viewCubeHoveredObject = hoverMaterialIndex;
			for (const object of this.viewCubeHitTargets) {
				const materials = Array.isArray(object.material) ? object.material : [object.material];

				for (const [index, material] of materials.entries()) {
					if (!material) continue;
					material.color?.copy(material.userData.baseColor || material.color);
					material.emissive?.copy(material.userData.baseEmissive || new THREE.Color(0x000000));
					if (index === hoverMaterialIndex && material.emissive) {
						material.color?.lerp(new THREE.Color(0xffffff), 0.16);
						material.emissive.lerp(new THREE.Color(0xffffff), 0.32);
					}
					material.needsUpdate = true;
				}
			}
		}

		_disposeViewCube() {
			const disposedGeometries = new Set();
			const disposedMaterials = new Set();

			this.viewCubeGroup?.traverse((object) => {
				if (object.geometry && !disposedGeometries.has(object.geometry)) {
					disposedGeometries.add(object.geometry);
					object.geometry.dispose();
				}

				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					if (!material || disposedMaterials.has(material)) continue;
					disposedMaterials.add(material);
					material.map?.dispose();
					material.dispose?.();
				}
			});

			this.viewCubeScene?.clear();
			this.viewCubeHitTargets = [];
			this.viewCubeGroup = null;
			this.viewCubeMesh = null;
		}

		_disposeAxesHelper() {
			const disposedGeometries = new Set();
			const disposedMaterials = new Set();

			this.axesGroup?.traverse((object) => {
				if (object.geometry && !disposedGeometries.has(object.geometry)) {
					disposedGeometries.add(object.geometry);
					object.geometry.dispose();
				}

				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					if (!material || disposedMaterials.has(material)) continue;
					disposedMaterials.add(material);
					material.map?.dispose();
					material.dispose?.();
				}
			});

			this.axesScene?.clear();
			this.axesGroup = null;
		}

		_renderWireOverlay() {
			if (!this.modelGroup || !this.wireframeMaterial) return;

			const previousOverrideMaterial = this.scene.overrideMaterial;
			const previousAutoClear = this.renderer.autoClear;
			const hiddenObjects = [];

			this.modelGroup.traverse((object) => {
				if (object.userData?.isExactSkeletonEdge && object.visible) {
					hiddenObjects.push(object);
					object.visible = false;
				}
			});

			this.scene.overrideMaterial = this.wireframeMaterial;
			this.renderer.autoClear = false;
			this._renderSceneWithoutBackground(() => {
				this.renderer.render(this.scene, this.camera);
			});
			this.renderer.autoClear = previousAutoClear;
			this.scene.overrideMaterial = previousOverrideMaterial;

			for (const object of hiddenObjects) {
				object.visible = true;
			}
		}

		_renderExactSkeletonOverlay() {
			if (!this.modelGroup) return;

			const previousAutoClear = this.renderer.autoClear;
			const hiddenMaterials = [];
			const shownSkeletons = [];

			this.modelGroup.traverse((object) => {
				if (object.userData?.isExactSkeletonEdge) {
					if (!object.visible) {
						shownSkeletons.push(object);
						object.visible = true;
					}
					return;
				}

				if (object.isMesh && object.material) {
					const materials = Array.isArray(object.material) ? object.material : [object.material];
					for (const material of materials) {
						hiddenMaterials.push([material, material.visible]);
						material.visible = false;
					}
				}
			});

			this.renderer.autoClear = false;
			this._renderSceneWithoutBackground(() => {
				this.renderer.render(this.scene, this.camera);
			});
			this.renderer.autoClear = previousAutoClear;

			for (const [material, visible] of hiddenMaterials) {
				material.visible = visible;
			}

			for (const object of shownSkeletons) {
				object.visible = false;
			}
		}

		_renderGpuSkeleton({ overlay = false, visibleOnly = false } = {}) {
			if (
				!this.edgeRenderTarget ||
				!this.edgeBackRenderTarget ||
				!this.edgeMaskRenderTarget ||
				!this.edgeBackMaskRenderTarget ||
				!this.edgeShaderMaterial ||
				!this.edgeCompositeMaterial ||
				!this.edgeQuad
			) {
				this.renderer.setRenderTarget(null);
				this.renderer.render(this.scene, this.camera);
				return;
			}

			const meshes = this._getVisibleModelMeshes();

			if (meshes.length === 0) return;

			const previousOverrideMaterial = this.scene.overrideMaterial;
			const previousVisibility = meshes.map((mesh) => mesh.visible);
			const previousNormalDepthTest = this.edgeNormalMaterial.depthTest;
			const previousNormalDepthWrite = this.edgeNormalMaterial.depthWrite;
			const previousBackDepthTest = this.edgeBackNormalMaterial.depthTest;
			const previousBackDepthWrite = this.edgeBackNormalMaterial.depthWrite;
			const previousAutoClear = this.renderer.autoClear;

			this.edgeNormalMaterial.depthTest = visibleOnly;
			this.edgeNormalMaterial.depthWrite = visibleOnly;
			this.edgeBackNormalMaterial.depthTest = visibleOnly;
			this.edgeBackNormalMaterial.depthWrite = visibleOnly;
			// Keep mask targets alive while iterating meshes, otherwise the last mesh wins.
			this.renderer.autoClear = false;

			this.renderer.setClearColor(0x000000, 0);
			this.renderer.setRenderTarget(this.edgeMaskRenderTarget);
			this.renderer.clear(true, true, true);
			this.renderer.setRenderTarget(this.edgeBackMaskRenderTarget);
			this.renderer.clear(true, true, true);

			this.edgeQuad.material = this.edgeShaderMaterial;
			if (visibleOnly) {
				this.scene.overrideMaterial = this.edgeNormalMaterial;
				this.renderer.setRenderTarget(this.edgeRenderTarget);
				this.renderer.clear(true, true, true);
				this._renderSceneWithoutBackground(() => {
					this.renderer.render(this.scene, this.camera);
				});

				this.edgeShaderMaterial.uniforms.tNormal.value = this.edgeRenderTarget.texture;
				this.renderer.setRenderTarget(this.edgeMaskRenderTarget);
				this.renderer.render(this.edgeScene, this.edgeCamera);
			} else {
				for (const mesh of meshes) {
					for (const currentMesh of meshes) currentMesh.visible = false;
					mesh.visible = true;

					this.scene.overrideMaterial = this.edgeNormalMaterial;
					this.renderer.setRenderTarget(this.edgeRenderTarget);
					this.renderer.clear(true, true, true);
					this._renderSceneWithoutBackground(() => {
						this.renderer.render(this.scene, this.camera);
					});

					this.edgeShaderMaterial.uniforms.tNormal.value = this.edgeRenderTarget.texture;
					this.renderer.setRenderTarget(this.edgeMaskRenderTarget);
					this.renderer.render(this.edgeScene, this.edgeCamera);

					this.scene.overrideMaterial = this.edgeBackNormalMaterial;
					this.renderer.setRenderTarget(this.edgeBackRenderTarget);
					this.renderer.clear(true, true, true);
					this._renderSceneWithoutBackground(() => {
						this.renderer.render(this.scene, this.camera);
					});

					this.edgeShaderMaterial.uniforms.tNormal.value = this.edgeBackRenderTarget.texture;
					this.renderer.setRenderTarget(this.edgeBackMaskRenderTarget);
					this.renderer.render(this.edgeScene, this.edgeCamera);
				}
			}

			meshes.forEach((mesh, index) => {
				mesh.visible = previousVisibility[index];
			});
			this.scene.overrideMaterial = previousOverrideMaterial;
			this.edgeNormalMaterial.depthTest = previousNormalDepthTest;
			this.edgeNormalMaterial.depthWrite = previousNormalDepthWrite;
			this.edgeBackNormalMaterial.depthTest = previousBackDepthTest;
			this.edgeBackNormalMaterial.depthWrite = previousBackDepthWrite;

			this.edgeQuad.material = this.edgeCompositeMaterial;
			this.renderer.setRenderTarget(null);
			this.renderer.setClearColor(0x000000, 0);
			if (!overlay) this.renderer.clear(true, true, true);
			this.renderer.render(this.edgeScene, this.edgeCamera);
			this.renderer.autoClear = previousAutoClear;
		}

		_startLoop = () =>
			// Запуск цикла отрисовки в каждом кадре
			{
				requestAnimationFrame(this._startLoop);
				const now = performance.now();
				const isProjectionTransitioning = this._updateProjectionTransition(now);
				const isCameraTransitioning = !isProjectionTransitioning && this._updateCameraTransition(now);
				if (!isProjectionTransitioning && !isCameraTransitioning) this.controls.update();
				if (this.needsRender) {
					this._renderFrame();
					this.needsRender = false;
				}
			};
	}

	function createFrustumLines(frustum) {
		const points = [];
		const planes = frustum.planes;

		for (let i = 0; i < 4; i++) {
			const start = new THREE.Vector3();
			const end = new THREE.Vector3();
			const normal = planes[i].normal.clone();

			const d = planes[i].constant;

			start.copy(normal).multiplyScalar(d);
			end.copy(normal).multiplyScalar(d + 10); // Длина линии

			points.push(start, end);
		}

		const geometry = new THREE.BufferGeometry().setFromPoints(points);
		const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
		return new THREE.LineSegments(geometry, lineMaterial);
	}

	//визуализация фрустума
	function createFrustumVisual(camera) {
		const geometry = new THREE.BufferGeometry();

		// Define the 8 corners of the frustum in NDC space
		const ndcCorners = [
			new THREE.Vector3(-1, -1, -1), // Near Bottom Left
			new THREE.Vector3(1, -1, -1), // Near Bottom Right
			new THREE.Vector3(1, 1, -1), // Near Top Right
			new THREE.Vector3(-1, 1, -1), // Near Top Left
			new THREE.Vector3(-1, -1, 1), // Far Bottom Left
			new THREE.Vector3(1, -1, 1), // Far Bottom Right
			new THREE.Vector3(1, 1, 1), // Far Top Right
			new THREE.Vector3(-1, 1, 1) // Far Top Left
		];

		// Unproject NDC corners to world space
		const worldCorners = ndcCorners.map((ndcPoint) => ndcPoint.clone().unproject(camera));

		// Convert world corner points to a typed array for BufferGeometry
		const vertices = new Float32Array(worldCorners.length * 3);
		worldCorners.forEach((point, index) => {
			vertices[index * 3] = point.x;
			vertices[index * 3 + 1] = point.y;
			vertices[index * 3 + 2] = point.z;
		});

		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

		// Define the indices for the faces of the frustum
		const indices = [
			// Near plane
			0, 1, 2, 2, 3, 0,
			// Far plane
			4, 5, 6, 6, 7, 4,
			// Sides
			0, 1, 5, 5, 4, 0, 1, 2, 6, 6, 5, 1, 2, 3, 7, 7, 6, 2, 3, 0, 4, 4, 7, 3
		];

		geometry.setIndex(indices);
		geometry.computeVertexNormals();

		// Create a semi-transparent material for the frustum
		// const material = new THREE.LineBasicMaterial({
		//     color: 0x00ff00,
		//     side: THREE.DoubleSide,
		//     transparent: true,
		//     opacity: 0.5
		// });

		const material = new THREE.LineDashedMaterial({
			color: 0xffff00,
			linewidth: 5,
			scale: 2,
			dashSize: 3,
			gapSize: 1
			// visible: this.enabled
		});

		const frustumMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material);

		return frustumMesh;
	}

	function createAxesGizmo() {
		const group = new THREE.Group();
		const axes = [
			{ label: 'X', direction: new THREE.Vector3(1, 0, 0), color: 0xff4f4f },
			{ label: 'Y', direction: new THREE.Vector3(0, 1, 0), color: 0x48c774 },
			{ label: 'Z', direction: new THREE.Vector3(0, 0, 1), color: 0x4da3ff }
		];

		for (const axis of axes) {
			const arrow = new THREE.ArrowHelper(axis.direction, new THREE.Vector3(0, 0, 0), 0.98, axis.color, 0.2, 0.1);
			arrow.traverse((object) => {
				if (object.material) {
					object.material.depthTest = false;
					object.material.depthWrite = false;
					object.material.toneMapped = false;
				}
			});
			group.add(arrow);

			const label = createAxisLabelSprite(axis.label, axis.color);
			label.position.copy(axis.direction).multiplyScalar(1.2);
			group.add(label);
		}

		return group;
	}

	function createAxisLabelSprite(text, color) {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 96;
		const context = canvas.getContext('2d');
		const colorString = `#${color.toString(16).padStart(6, '0')}`;

		context.clearRect(0, 0, canvas.width, canvas.height);
		context.font = '700 52px Arial, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.lineWidth = 8;
		context.strokeStyle = 'rgba(20, 24, 30, 0.72)';
		context.strokeText(text, 48, 50);
		context.fillStyle = colorString;
		context.fillText(text, 48, 50);

		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;

		const material = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});
		const sprite = new THREE.Sprite(material);
		sprite.scale.set(0.42, 0.42, 1);
		return sprite;
	}

	function createViewCube() {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(VIEW_CUBE_MODEL.positions, 3)
		);
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(VIEW_CUBE_MODEL.normals, 3));
		geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(VIEW_CUBE_MODEL.indices), 1));

		const materials = VIEW_CUBE_MODEL.groups.map((group) => {
			const materialColor = getViewCubeMaterialColor(group);
			const color = new THREE.Color(materialColor);
			const material = new THREE.MeshPhongMaterial({
				color,
				emissive: color.clone().multiplyScalar(getViewCubeFaceAxis(group) ? 0.1 : 0.04),
				specular: 0x1a3444,
				shininess: 24,
				flatShading: true,
				transparent: false,
				opacity: 1,
				depthTest: true,
				depthWrite: true
			});
			material.userData.baseColor = material.color.clone();
			material.userData.baseEmissive = material.emissive.clone();
			return material;
		});

		for (const [index, group] of VIEW_CUBE_MODEL.groups.entries()) {
			geometry.addGroup(group.start, group.count, index);
		}

		const mesh = new THREE.Mesh(geometry, materials);
		mesh.name = 'View orientation cube';
		mesh.renderOrder = 10;

		const outline = new THREE.LineSegments(
			new THREE.EdgesGeometry(geometry, 22),
			new THREE.LineBasicMaterial({
				color: VIEW_CUBE_OUTLINE_COLOR,
				transparent: false,
				opacity: 1,
				depthTest: true,
				depthWrite: false
			})
		);
		outline.renderOrder = 40;
		mesh.add(outline);

		for (const label of VIEW_CUBE_FACE_LABELS) {
			mesh.add(createViewCubeLabel(label));
		}

		const group = new THREE.Group();
		group.add(mesh);
		return { group, hitTargets: [mesh], outline };
	}

	function getViewCubeMaterialColor(group) {
		const faceAxis = getViewCubeFaceAxis(group);
		if (faceAxis) return VIEW_CUBE_FACE_COLORS[faceAxis];
		return VIEW_CUBE_MATERIAL_COLORS[group.material % VIEW_CUBE_MATERIAL_COLORS.length];
	}

	function getViewCubeFaceAxis(group) {
		if (group.material !== 0 || group.count < 30) return '';

		return getViewCubeAxisFromNormal(getViewCubeGroupNormal(group), 0.95);
	}

	function getViewCubeAxisFromNormal(normal, threshold = 0.95) {
		const absX = Math.abs(normal.x);
		const absY = Math.abs(normal.y);
		const absZ = Math.abs(normal.z);
		const maxAxis = Math.max(absX, absY, absZ);
		if (maxAxis < threshold) return '';

		if (maxAxis === absX) return normal.x >= 0 ? 'right' : 'left';
		if (maxAxis === absY) return normal.y >= 0 ? 'back' : 'front';
		return normal.z >= 0 ? 'top' : 'bottom';
	}

	function getViewCubeGroupNormal(group) {
		const normal = new THREE.Vector3();
		const indices = VIEW_CUBE_MODEL.indices;
		const normals = VIEW_CUBE_MODEL.normals;

		for (let index = group.start; index < group.start + group.count; index += 1) {
			const vertexIndex = indices[index] * 3;
			normal.x += normals[vertexIndex];
			normal.y += normals[vertexIndex + 1];
			normal.z += normals[vertexIndex + 2];
		}

		return normal.normalize();
	}

	function createViewCubeLabel({ label, normal, up }) {
		const planeNormal = vectorFromArray(normal).normalize();
		const upVector = vectorFromArray(up).normalize();
		const axis = getViewCubeAxisFromNormal(planeNormal);
		const texture = createViewCubeLabelTexture(label, VIEW_CUBE_LABEL_COLORS[axis] || '#141922');
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthTest: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -3,
			polygonOffsetUnits: -3
		});
		const width = label.length > 3 ? 1.55 : 1.2;
		const height = 0.48;
		const geometry = new THREE.PlaneGeometry(width, height);
		const mesh = new THREE.Mesh(geometry, material);
		const basisX = upVector.clone().cross(planeNormal).normalize();
		const basisY = planeNormal.clone().cross(basisX).normalize();
		const labelRotation = VIEW_CUBE_LABEL_ROTATIONS[axis] || 0;
		if (labelRotation !== 0) {
			const rotation = new THREE.Matrix4().makeRotationAxis(planeNormal, labelRotation);
			basisX.applyMatrix4(rotation).normalize();
			basisY.applyMatrix4(rotation).normalize();
		}
		const matrix = new THREE.Matrix4().makeBasis(basisX, basisY, planeNormal);

		mesh.name = `View cube label ${label}`;
		mesh.position.copy(planeNormal).multiplyScalar(1.028);
		mesh.quaternion.setFromRotationMatrix(matrix);
		mesh.renderOrder = 30;
		return mesh;
	}

	function createViewCubeLabelTexture(label, color) {
		const width = 512;
		const height = 192;
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		canvas.width = width;
		canvas.height = height;

		context.clearRect(0, 0, width, height);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		let fontSize = 126;
		do {
			context.font = `800 ${fontSize}px Arial, sans-serif`;
			fontSize -= 4;
		} while (context.measureText(label).width > width * 0.82 && fontSize > 56);
		context.fillStyle = color;
		context.fillText(label, width / 2, height / 2 + 1);

		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = 4;
		texture.needsUpdate = true;
		return texture;
	}

	function getViewDirection(view) {
		const direction = new THREE.Vector3();
		for (const token of String(view || '').split('-')) {
			direction.add(vectorFromAxis(token));
		}
		return direction;
	}

	function getViewUpVector(view, direction, verticalSign = 1) {
		const tokens = new Set(String(view || '').toLowerCase().split('-').filter(Boolean));
		const hasTop = tokens.has('top');
		const hasBottom = tokens.has('bottom');
		const sideTokenCount = ['front', 'back', 'left', 'right'].filter((token) => tokens.has(token)).length;
		const pureVertical = Math.abs(direction.z) > 0.999;

		if (pureVertical) {
			return direction.z > 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);
		}

		if (hasTop) return new THREE.Vector3(0, 1, 0);
		if (hasBottom) return new THREE.Vector3(0, -1, 0);
		if (sideTokenCount >= 1) {
			return new THREE.Vector3(0, verticalSign < 0 ? -1 : 1, 0);
		}

		return new THREE.Vector3(0, 0, 1);
	}

	function getViewVerticalSign(view) {
		const tokens = new Set(String(view || '').toLowerCase().split('-').filter(Boolean));
		if (tokens.has('top')) return 1;
		if (tokens.has('bottom')) return -1;
		return 0;
	}

	function getSafeViewUpVector(preferredUp, direction) {
		const safeDirection = direction.clone().normalize();
		const safeUp = preferredUp.clone().normalize();

		if (safeDirection.lengthSq() === 0) return new THREE.Vector3(0, 0, 1);
		if (safeUp.lengthSq() === 0 || Math.abs(safeUp.dot(safeDirection)) > 0.985) {
			const fallbackAxes = [
				new THREE.Vector3(0, 0, 1),
				new THREE.Vector3(0, 1, 0),
				new THREE.Vector3(1, 0, 0)
			].sort((a, b) => Math.abs(a.dot(safeDirection)) - Math.abs(b.dot(safeDirection)));
			safeUp.copy(fallbackAxes[0]);
		}

		return safeUp;
	}

	function getNearestSnappedUpVector(direction, currentUp, canonicalUp) {
		const safeDirection = direction.clone().normalize();
		const baseUp = projectVectorToPlane(canonicalUp, safeDirection) || getSafeViewUpVector(canonicalUp, safeDirection);
		const currentProjectedUp = projectVectorToPlane(currentUp, safeDirection);

		if (!currentProjectedUp) return baseUp;

		const candidates = [];
		for (let index = 0; index < 4; index += 1) {
			candidates.push(baseUp.clone().applyAxisAngle(safeDirection, index * Math.PI * 0.5).normalize());
		}

		return candidates.sort((a, b) => b.dot(currentProjectedUp) - a.dot(currentProjectedUp))[0];
	}

	function projectVectorToPlane(vector, normal) {
		if (!vector || !normal) return null;

		const projected = vector.clone().sub(normal.clone().multiplyScalar(vector.dot(normal)));
		if (projected.lengthSq() < 0.000001) return null;
		return projected.normalize();
	}

	function vectorFromAxis(axis) {
		return vectorFromArray(VIEW_CUBE_AXIS_VECTORS[axis] || [0, 0, 0]);
	}

	function vectorFromArray(value) {
		return new THREE.Vector3(value[0], value[1], value[2]);
	}

	function getViewFromViewCubeNormal(normal) {
		if (!normal) return '';
		return getViewFromNormal(normal.clone());
	}

	function isPrimaryViewCubeView(view) {
		const tokens = getViewTokens(view);
		return tokens.length === 1 && Boolean(VIEW_CUBE_AXIS_VECTORS[tokens[0]]);
	}

	function getViewTokens(view) {
		return String(view || '').toLowerCase().split('-').filter(Boolean);
	}

	function getCameraViewFromViewCubeView(view) {
		const direction = getViewDirection(view);
		if (direction.lengthSq() === 0) return '';
		return getViewFromNormal(direction.applyQuaternion(VIEW_CUBE_ORIENTATION_CORRECTION_INVERSE));
	}

	function getViewFromNormal(normal) {
		if (!normal) return '';

		const direction = normal.clone().normalize();
		const axes = [
			{ token: direction.z >= 0 ? 'top' : 'bottom', value: Math.abs(direction.z), priority: 0 },
			{ token: direction.y >= 0 ? 'back' : 'front', value: Math.abs(direction.y), priority: 1 },
			{ token: direction.x >= 0 ? 'right' : 'left', value: Math.abs(direction.x), priority: 2 }
		];
		const maxValue = Math.max(...axes.map((axis) => axis.value));
		const threshold = maxValue > 0.75 ? 0.38 : 0.32;
		const viewAxes = axes.filter((axis) => axis.value >= threshold);
		if (viewAxes.length === 0) viewAxes.push(axes.sort((a, b) => b.value - a.value || a.priority - b.priority)[0]);

		return viewAxes
			.sort((a, b) => a.priority - b.priority)
			.map((axis) => axis.token)
			.join('-');
	}

	// Функция для десериализации Object3D
	// function deserializeObject3D(data, arrayBuffers) {
	//     let object;

	//     // Создаем объект нужного типа
	//     if (data.type === 'Mesh') {
	//         object = new THREE.Mesh();
	//     } else if (data.type === 'LineSegments') {
	//         object = new THREE.LineSegments();
	//     } else {
	//         throw new Error(`Unsupported object type: ${data.type}`);
	//     }

	//     // Десериализация геометрии
	//     const geometryData = data.geometry;
	//     const geometry = new THREE.BufferGeometry();
	//     const attributes = geometryData.attributes;

	//     for (const name in attributes) {
	//         const attrData = attributes[name];
	//         // const arrayType = attrData.arrayType;
	//         // const ArrayConstructor = globalThis[arrayType];

	//         const array = arrayBuffers[attrData.bufferIndex];

	//         const attribute = new THREE.BufferAttribute(array, attrData.itemSize, attrData.normalized);
	//         geometry.setAttribute(name, attribute);
	//     }

	//     // Десериализация индексов (если есть)
	//     if (geometryData.index) {
	//         const indexData = geometryData.index;
	//         // const arrayType = indexData.arrayType;
	//         // const ArrayConstructor = globalThis[arrayType];

	//         const array = arrayBuffers[indexData.bufferIndex];

	//         const indexAttribute = new THREE.BufferAttribute(array, indexData.itemSize, indexData.normalized);
	//         geometry.setIndex(indexAttribute);
	//     }

	//     object.geometry = geometry;

	//     // Десериализация материала (упрощенно)
	//     const materialData = data.material;

	//     let material;
	//     if (materialData.type === 'MeshBasicMaterial') {
	//         material = new THREE.MeshBasicMaterial({ color: materialData.color });
	//     } else if (materialData.type === 'LineBasicMaterial') {
	//         material = new THREE.LineBasicMaterial({ color: materialData.color, linewidth: materialData.linewidth });
	// 	} else if (materialData.type === 'MeshMatcapMaterial') {
	//         material = new THREE.MeshMatcapMaterial({ color: materialData.color});
	//     } else {
	//         material = new THREE.MeshBasicMaterial();
	//     }

	//     object.material = material;

	//     // Устанавливаем матрицу трансформации
	// 	// console.log(data.matrix);
	//     object.matrix.fromArray(data.matrix);
	//     object.matrix.decompose(object.position, object.quaternion, object.scale);

	//     // Восстанавливаем пользовательские данные
	//     object.userData = data.userData;

	//     return object;
	// }

	function deserializeObject3D(data) {
		let object;

		if (data.type === 'Mesh') {
			object = new THREE.Mesh();
		} else if (data.type === 'LineSegments') {
			object = new THREE.LineSegments();
		} else if (data.type === 'Group' || data.type === 'Object3D') {
			object = new THREE.Group();
		} else {
			console.warn(`Неподдерживаемый тип объекта: ${data.type}, создается Object3D`);
			object = new THREE.Object3D();
		}

		object.uuid = data.uuid;
		object.name = data.name;
		object.userData = data.userData;
		object.matrix.fromArray(data.matrix);
		object.matrix.decompose(object.position, object.quaternion, object.scale);

		if (data.geometry) {
			object.geometry = deserializeGeometry(data.geometry);
		}

		// if (data.material) {
		//     object.material = deserializeMaterial(data.material);
		// }

		if (Array.isArray(data.material)) {
			// Если это массив материалов, десериализуем каждый
			object.material = data.material.map((matData) => deserializeMaterial(matData));
		}

		if (!Array.isArray(data.material) && data.material !== undefined) {
			// Если один материал
			object.material = deserializeMaterial(data.material);
		}

		// Рекурсивная десериализация дочерних объектов
		for (const childData of data.children) {
			const child = deserializeObject3D(childData);
			object.add(child);
		}

		return object;
	}

	function deserializeGeometry(data) {
		const geometry = new THREE.BufferGeometry();

		// Десериализуем атрибуты
		for (const name in data.attributes) {
			const attrData = data.attributes[name];
			const arrayType = attrData.arrayType;
			const ArrayConstructor = globalThis[arrayType];
			const array = new ArrayConstructor(attrData.buffer);
			const attribute = new THREE.BufferAttribute(array, attrData.itemSize, attrData.normalized);
			geometry.setAttribute(name, attribute);
		}

		// Десериализуем индексы
		if (data.index) {
			const indexData = data.index;
			const arrayType = indexData.arrayType;
			const ArrayConstructor = globalThis[arrayType];
			const array = new ArrayConstructor(indexData.buffer);
			const indexAttribute = new THREE.BufferAttribute(
				array,
				indexData.itemSize,
				indexData.normalized
			);
			geometry.setIndex(indexAttribute);
		}

		return geometry;
	}

	function deserializeMaterial(data) {
		let material;
		console.log('test data', data);

		switch (data.type) {
			case 'MeshBasicMaterial':
				material = new THREE.MeshBasicMaterial();
				break;
			case 'MeshStandardMaterial':
				material = new THREE.MeshStandardMaterial();
				break;
			case 'MeshPhongMaterial':
				material = new THREE.MeshPhongMaterial();
				break;
			case 'MeshLambertMaterial':
				material = new THREE.MeshLambertMaterial();
				break;
			case 'MeshMatcapMaterial':
				material = new THREE.MeshMatcapMaterial();
				break;
			case 'LineBasicMaterial':
				material = new THREE.LineBasicMaterial();
				break;
			// Добавьте другие типы материалов при необходимости
			default:
				console.log('material:', data);
				console.warn(
					`Неподдерживаемый тип материала: ${data.type}, используется MeshBasicMaterial`
				);
				material = new THREE.MeshBasicMaterial();
				break;
		}

		material.uuid = data.uuid;
		material.name = data.name;

		if (data.color !== null) material.color = new THREE.Color(data.color);
		if (data.emissive !== null && material.emissive)
			material.emissive = new THREE.Color(data.emissive);
		if (data.roughness !== null && material.roughness !== undefined)
			material.roughness = data.roughness;
		if (data.metalness !== null && material.metalness !== undefined)
			material.metalness = data.metalness;

		material.opacity = data.opacity;
		material.transparent = data.transparent;
		material.side = data.side;
		material.depthTest = data.depthTest;
		material.depthWrite = data.depthWrite;
		material.wireframe = data.wireframe;
		if (data.map) material.map = deserializeTexture(data.map);
		if (data.normalMap) material.normalMap = deserializeTexture(data.normalMap);
		if (data.roughnessMap && material.roughnessMap !== undefined)
			material.roughnessMap = deserializeTexture(data.roughnessMap);
		if (data.metalnessMap && material.metalnessMap !== undefined)
			material.metalnessMap = deserializeTexture(data.metalnessMap);
		if (data.emissiveMap && material.emissiveMap !== undefined)
			material.emissiveMap = deserializeTexture(data.emissiveMap);
		if (data.alphaMap) material.alphaMap = deserializeTexture(data.alphaMap);

		// Восстановите другие свойства материала при необходимости

		return material;
	}

	function deserializeTexture(data) {
		let texture;

		if (data.image && data.image.data) {
			// Создаем текстуру из данных
			const ArrayConstructor = globalThis[data.image.dataType];
			const array = new ArrayConstructor(data.image.data);
			const imageData = {
				data: array,
				width: data.image.width,
				height: data.image.height
			};
			texture = new THREE.DataTexture(imageData.data, imageData.width, imageData.height);
			texture.needsUpdate = true;
		} else if (data.image && data.image.src) {
			// Загружаем текстуру из изображения
			texture = new THREE.TextureLoader().load(data.image.src);
		} else {
			texture = new THREE.Texture();
		}

		texture.uuid = data.uuid;
		texture.name = data.name;
		texture.wrapS = data.wrapS !== undefined ? data.wrapS : THREE.ClampToEdgeWrapping;
		texture.wrapT = data.wrapT !== undefined ? data.wrapT : THREE.ClampToEdgeWrapping;
		texture.repeat = new THREE.Vector2().fromArray(data.repeat || [1, 1]);
		texture.offset = new THREE.Vector2().fromArray(data.offset || [0, 0]);
		texture.rotation = data.rotation !== undefined ? data.rotation : 0;

		// Восстановите другие свойства текстуры при необходимости

		return texture;
	}

	function handleLoadedObject(object3D, fileName, requestId, sourceTiming = {}, options = {}) {
		if (requestId !== loadToken) return;

		const loadQuality = options.loadQuality || 'final';
		const quickStatsStart = performance.now();
		const quickStats = options.workerWillAnalyze
			? {}
			: calculateModelStats(object3D, { includeVolume: false });
		const quickStatsMs = performance.now() - quickStatsStart;
		let analysisPayload = null;
		let analysisCollectMs = 0;
		if (!options.workerWillAnalyze) {
			const collectStart = performance.now();
			analysisPayload = collectGeometryAnalysisPayload(object3D);
			analysisCollectMs = performance.now() - collectStart;
		}

		dispatch('modelstats', {
			fileName,
			...quickStats,
			statsStage: 'quick',
			isVolumePending: true,
			isPrintVolumePending: true
		});

		dispatch('modeltree', {
			fileName,
			...buildModelNavigatorTree(object3D)
		});

		const sceneStart = performance.now();
		sm.updateScene(object3D);
		const sceneMs = performance.now() - sceneStart;
		spinner = false;

		const timing = {
			...sourceTiming,
			quickStatsMs,
			...(analysisCollectMs > 0 ? { analysisCollectMs } : {}),
			sceneMs
		};

		console.info('[viewer-load]', {
			fileName,
			phase: loadQuality === 'cache' ? 'cache-visible' : 'visible',
			...formatTiming(timing)
		});

		if (!options.workerWillAnalyze) {
			requestWorkerAnalysis(analysisPayload, fileName, requestId, timing, options.analysisOptions);
		}
	}

	function buildModelNavigatorTree(object3D) {
		let meshCount = 0;
		let nodeCount = 0;
		const derivedNameCache = new WeakMap();

		function createTreeNode(object, depth = 0) {
			if (object.isMesh) {
				meshCount += 1;

				return {
					id: `mesh:${object.uuid}`,
					kind: 'mesh',
					meshId: object.uuid,
					name: getObjectDisplayName(object, `Mesh ${meshCount}`),
					color: getMeshDisplayColor(object),
					visible: object.visible !== false,
					children: getNavigatorChildren(object, depth + 1)
				};
			}

			const children = getNavigatorChildren(object, depth + 1);
			const explicitName = getObjectName(object);
			const name = explicitName || getDerivedSourceNodeName(object);
			if (
				depth > 0 &&
				children.length === 1 &&
				(!name || (!explicitName && children[0].kind === 'mesh' && name === children[0].name))
			) {
				return children[0];
			}

			nodeCount += 1;
			return {
				id: `node:${object.uuid}`,
				kind: 'node',
				name: name || (depth === 0 ? 'Model' : `Group ${nodeCount}`),
				children
			};
		}

		function getNavigatorChildren(object, depth) {
			return (object.children || [])
				.filter(hasNavigatorContent)
				.map((child) => createTreeNode(child, depth));
		}

		function getDerivedSourceNodeName(object) {
			if (derivedNameCache.has(object)) return derivedNameCache.get(object);

			const paths = [];
			object.traverse((child) => {
				if (!child.isMesh) return;
				const path = getSourceNodePath(child);
				if (path.length > 0) paths.push(path);
			});

			if (paths.length === 0) {
				derivedNameCache.set(object, '');
				return '';
			}

			let commonLength = paths[0].length;
			for (let pathIndex = 1; pathIndex < paths.length; pathIndex += 1) {
				const path = paths[pathIndex];
				let nextCommonLength = 0;
				while (
					nextCommonLength < commonLength &&
					nextCommonLength < path.length &&
					sourceNodePathItemsEqual(paths[0][nextCommonLength], path[nextCommonLength])
				) {
					nextCommonLength += 1;
				}
				commonLength = nextCommonLength;
				if (commonLength === 0) break;
			}

			const name = commonLength > 0 ? paths[0][commonLength - 1].name : '';
			derivedNameCache.set(object, name);
			return name;
		}

		function getSourceNodePath(mesh) {
			const path = [];
			const seen = new Set();
			let sourceNode = mesh.userData?.originalMeshInstance?.node || null;

			while (sourceNode && !seen.has(sourceNode)) {
				seen.add(sourceNode);
				const name = normalizeObjectName(
					typeof sourceNode.GetName === 'function' ? sourceNode.GetName() : sourceNode.name
				);
				if (name) {
					path.unshift({
						id: typeof sourceNode.GetId === 'function' ? sourceNode.GetId() : sourceNode.id,
						name
					});
				}
				sourceNode = sourceNode.parent || null;
			}

			return path;
		}

		function sourceNodePathItemsEqual(left, right) {
			if (!left || !right) return false;
			if (left.id !== undefined && right.id !== undefined) return left.id === right.id;
			return left.name === right.name;
		}

		const tree = createTreeNode(object3D);
		return { tree, meshCount };
	}

	function hasNavigatorContent(object) {
		if (!object || object.userData?.isExactSkeletonEdge) return false;
		if (object.isMesh) return true;
		return (object.children || []).some(hasNavigatorContent);
	}

	function getObjectDisplayName(object, fallback) {
		return getObjectName(object) || fallback;
	}

	function getObjectName(object) {
		return normalizeObjectName(object?.name || object?.geometry?.name || '');
	}

	function normalizeObjectName(name) {
		return String(name || '').replace(/\s+/g, ' ').trim();
	}

	function getMeshDisplayColor(mesh) {
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		const materialWithColor = materials.find((material) => material?.color);

		if (!materialWithColor?.color) return '#cccccc';
		return `#${materialWithColor.color.getHexString()}`;
	}

	function isHexColor(value) {
		return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
	}

	function requestWorkerAnalysis(analysisPayload, fileName, requestId, timing, analysisOptions) {
		setTimeout(async () => {
			if (requestId !== loadToken || !analysisPayload) return;

			await ensureWorker();
			if (requestId !== loadToken) return;

			const { meshes, transfer } = analysisPayload;

			worker.postMessage(
				{
					type: 'analyze',
					requestId,
					meshes,
					analysisOptions: createAnalysisOptions(analysisOptions),
					timing
				},
				transfer
			);
		}, 0);
	}

	function formatTiming(timing) {
		return Object.fromEntries(
			Object.entries(timing).map(([key, value]) => [
				key,
				typeof value === 'number' ? Math.round(value * 10) / 10 : value
			])
		);
	}

	function getFileCacheKey(file) {
		if (!file) return '';
		return `${file.name}|${file.size}|${file.lastModified || 0}`;
	}

	function getCachedModel(cacheKey) {
		if (!cacheKey || !modelCache.has(cacheKey)) return null;

		const cachedModel = modelCache.get(cacheKey);
		modelCache.delete(cacheKey);
		modelCache.set(cacheKey, cachedModel);
		return cachedModel;
	}

	function cacheSerializedModel(cacheKey, fileName, object, timing = {}) {
		if (!cacheKey || !object) return;

		modelCache.set(cacheKey, {
			fileName,
			object,
			timing,
			cachedAt: performance.now()
		});

		while (modelCache.size > MODEL_CACHE_LIMIT) {
			const oldestKey = modelCache.keys().next().value;
			modelCache.delete(oldestKey);
		}
	}

	async function initializeWorker() {
		if (worker) return;

		worker = new Worker(new URL('./loadWorker.js', import.meta.url), { type: 'module' }); // Создаем новый веб-воркер

		// Устанавливаем обработчик для сообщений от воркера
		worker.onmessage = (event) => {
			// const geometry = deserializeGeometry(event.data);
			// const json_obj = event.data;
			// renderObject(json_obj)

			if (event.data?.requestId !== loadToken) return;

			if (event.data?.type === 'error') {
				dispatch('modelloaderror', {
					fileName: currentFileName,
					message: event.data.message || 'Failed to load model.'
				});
				spinner = false;
				return;
			}

			if (event.data?.type === 'stats') {
				dispatch('modelstats', {
					fileName: currentFileName,
					...event.data.stats,
					statsStage: 'full',
					isVolumePending: false
				});
				console.info('[viewer-load]', {
					fileName: currentFileName,
					phase: 'worker-stats',
					...formatTiming(event.data.timing || {})
				});
				return;
			}

			if (event.data?.type === 'selectionStats') {
				dispatch('selectiondetails', {
					fileName: currentFileName,
					selectionRequestId: event.data.selectionRequestId,
					meshIds: event.data.meshIds || [],
					...event.data.stats,
					statsStage: 'selection-full',
					isSelectionPending: false,
					isVolumePending: false
				});
				console.info('[viewer-selection]', {
					fileName: currentFileName,
					phase: 'worker-selection-stats',
					...formatTiming(event.data.timing || {})
				});
				return;
			}

			if (event.data?.type === 'selectionPrintStats') {
				dispatch('selectiondetails', {
					fileName: currentFileName,
					selectionRequestId: event.data.selectionRequestId,
					meshIds: event.data.meshIds || [],
					...event.data.printStats,
					statsStage: 'selection-print',
					isPrintVolumePending: false
				});
				console.info('[viewer-selection]', {
					fileName: currentFileName,
					phase: 'worker-selection-print-volume',
					...formatTiming(event.data.timing || {})
				});
				return;
			}

			if (event.data?.type === 'printStats') {
				dispatch('modelstats', {
					fileName: currentFileName,
					...event.data.printStats,
					statsStage: 'print',
					isPrintVolumePending: false
				});
				console.info('[viewer-load]', {
					fileName: currentFileName,
					phase: 'worker-print-volume',
					...formatTiming(event.data.timing || {})
				});
				return;
			}

			if (event.data?.type === 'skeleton') {
				sm.attachSkeleton(event.data.items || []);
				if (event.data.topology) {
					dispatch('modelstats', {
						fileName: currentFileName,
						statsStage: 'topology',
						topology: event.data.topology,
						topologyPending: false
					});
				}
				console.info('[viewer-load]', {
					fileName: currentFileName,
					phase: 'worker-skeleton',
					...formatTiming(event.data.timing || {})
				});
				return;
			}

			if (event.data?.type !== 'loaded') return;

			cacheSerializedModel(currentLoadCacheKey, currentFileName, event.data.object, event.data.timing || {});

			const deserializeStart = performance.now();
			const object3D = deserializeThreeObject3D(event.data.object);
			handleLoadedObject(object3D, currentFileName, event.data.requestId, {
				...(event.data.timing || {}),
				deserializeMs: performance.now() - deserializeStart
			}, {
				workerWillAnalyze: Boolean(event.data.backgroundJobs)
			});

			// const mg = new MeshGenerator(geometry); // Для первого меша
			// const lmg = new LinearMeshGenerator(geometry); // Для первого линейного меша

			// // Настраиваем материал и обновляем меши
			// mg.setMatcap("matcap.jpg");
			// mg.update();
			// lmg.update();

			// // Обновляем сцену с созданными мешами
			// console.log(sm, mg.getMesh(), lmg.getMesh())
			// sm.updateScene([mg.getMesh(), lmg.getMesh()]);
		};

		// Обработчик ошибок веб-воркера
		worker.onerror = (error) => {
			console.error('Ошибка в воркере:', error); // Выводим ошибку в консоль
		};
	}

	async function ensureWorker() {
		if (workerReady) {
			await workerReady;
			return;
		}

		if (!worker) {
			workerReady = initializeWorker();
			await workerReady;
		}
	}

	export async function renderFile(file, options = {}) {
		if (!file || !isSupportedFile(file)) return false;

		droparea = false;
		spinner = true;
		currentFileName = file.name;
		currentAnalysisOptions = createAnalysisOptions(options.analysisOptions, file);
		const requestId = ++loadToken;
		currentLoadCacheKey = getFileCacheKey(file);

		const cachedModel = getCachedModel(currentLoadCacheKey);
		if (cachedModel) {
			const deserializeStart = performance.now();
			const object3D = deserializeThreeObject3D(cachedModel.object);
			handleLoadedObject(object3D, file.name, requestId, {
				cacheHit: true,
				cacheAgeMs: performance.now() - cachedModel.cachedAt,
				...(cachedModel.timing || {}),
				deserializeMs: performance.now() - deserializeStart
			}, {
				analysisOptions: currentAnalysisOptions,
				loadQuality: 'cache'
			});
			return true;
		}

		if (canLoadWithOnline3DViewer(file)) {
			try {
				const loadStart = performance.now();
				const object3D = await loadWithOnline3DViewer(file);
				handleLoadedObject(object3D, file.name, requestId, {
					o3dvLoadMs: performance.now() - loadStart
				}, {
					analysisOptions: currentAnalysisOptions
				});
			} catch (error) {
				if (requestId !== loadToken) return true;
				dispatch('modelloaderror', {
					fileName: file.name,
					message: error instanceof Error ? error.message : String(error)
				});
				spinner = false;
			} finally {
				if (requestId === loadToken && spinner) spinner = false;
			}
			return true;
		}

		await ensureWorker();

		worker.postMessage({ file, requestId, analysisOptions: currentAnalysisOptions });
		return true;
	}

	export async function reanalyzeCurrentModel(analysisOptions = {}) {
		currentAnalysisOptions = createAnalysisOptions(analysisOptions, null);
		await ensureWorker();
		worker.postMessage({
			type: 'reanalyze',
			requestId: loadToken,
			analysisOptions: currentAnalysisOptions
		});
	}

	export async function requestSelectionDetails(meshIds, options = {}) {
		const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
		if (ids.length === 0) return;

		await ensureWorker();
		worker.postMessage({
			type: 'selectionDetails',
			requestId: loadToken,
			selectionRequestId: options.selectionRequestId,
			meshIds: ids,
			analysisOptions: createAnalysisOptions(options.analysisOptions || currentAnalysisOptions, null)
		});
	}

	export function fitModel() {
		sm?.fitModel();
	}

	export function resetView() {
		sm?.resetView();
	}

	export function clearModel() {
		loadToken += 1;
		currentFileName = '';
		currentLoadCacheKey = '';
		currentAnalysisOptions = createAnalysisOptions();
		spinner = false;
		sm?.clearModel();
	}

	export function setProjectionMode(mode) {
		sm?.setProjectionMode(mode);
	}

	export function setView(view, options) {
		sm?.setView(view, options);
	}

	export function setDisplayMode(mode) {
		sm?.setDisplayMode(mode);
	}

	export function setDisplayState(state) {
		sm?.setDisplayState(state);
	}

	export function setBackfaceCulling(enabled) {
		sm?.setBackfaceCulling(enabled);
	}

	export function setVertexColorsEnabled(enabled) {
		sm?.setVertexColorsEnabled(enabled);
	}

	export function setSsaoSettings(settings) {
		sm?.setSsaoSettings(settings);
	}

	export function setMeshColor(meshId, color) {
		return sm?.setMeshColor(meshId, color);
	}

	export function selectMesh(meshId) {
		return sm?.selectMesh(meshId);
	}

	export function focusMeshes(meshIds, options) {
		return sm?.focusMeshes(meshIds, options);
	}

	export function clearMeshFocus() {
		return sm?.clearMeshFocus();
	}

	export function setMeshVisibility(meshId, visible) {
		return sm?.setMeshVisibility(meshId, visible);
	}

	export function setMeshesVisibility(meshIds, visible) {
		return sm?.setMeshesVisibility(meshIds, visible);
	}

	export function snapshot() {
		return sm?.snapshot();
	}

	export function snapshotBlob() {
		return sm?.snapshotBlob();
	}

	export function exportModel(format, options) {
		return sm?.exportModel(format, options);
	}

	function isSupportedFile(file) {
		const fileName = file.name.toLowerCase();
		return allowedExtensions.some((ext) => fileName.endsWith(ext));
	}

	function createAnalysisOptions(options = {}, file = null) {
		const fileIsStl = file?.name?.toLowerCase?.().endsWith('.stl') || false;
		return {
			unitScale: Number.isFinite(options.unitScale) && options.unitScale > 0 ? options.unitScale : 1,
			unitLabel: options.unitLabel || 'Millimeter',
			unitless: options.unitless !== undefined ? Boolean(options.unitless) : fileIsStl,
			printLayerHeightMm:
				Number.isFinite(options.printLayerHeightMm) && options.printLayerHeightMm > 0
					? options.printLayerHeightMm
					: 0.2,
			printMaxLayers:
				Number.isFinite(options.printMaxLayers) && options.printMaxLayers > 0
					? options.printMaxLayers
					: 180,
			printScanlines:
				Number.isFinite(options.printScanlines) && options.printScanlines > 0
					? options.printScanlines
					: 72
		};
	}

	function handlerDrop(event) {
		if (!enDrop) return;
		event.preventDefault();

		let files = [];
		const items = event.dataTransfer.files;
		for (let i = 0; i < items.length; i++) {
			const file = event.dataTransfer.files[i];

			// if (!file["name"].toLowerCase().endsWith(".stl")) return;

			if (!isSupportedFile(file)) return;

			files.push(file);
		}

		if (files.length <= 0) return;
		dispatch('drop', { files });

		// Передаем массив файлов в воркер для обработки

		renderFile(files.at(-1));

		// const loader = new STLLoader()
		// console.log(URL.createObjectURL(files.at(-1)));
		// loader.load(URL.createObjectURL(files.at(-1)), geometry => {
		// 	console.log(geometry)
		// 	const mg = new MeshGenerator(geometry); // Для первого меша
		// 	const lmg = new LinearMeshGenerator(geometry); // Для первого линейного меша

		// 	// Настраиваем материал и обновляем меши
		// 	mg.setMatcap("matcap.jpg");
		// 	mg.update();
		// 	lmg.update();

		// 	// Обновляем сцену с созданными мешами
		// 	console.log(sm, mg.getMesh(), lmg.getMesh())
		// 	sm.updateScene([mg.getMesh(), lmg.getMesh()]);

		// });
	}

	onMount(() => {
		sm = new SceneManager(viewer, viewField.clientWidth, viewField.clientHeight);

		const resizeObserver = new ResizeObserver(() => {
			if (!sm || !viewField) return;
			sm.viewerResize(viewField.clientWidth, viewField.clientHeight);
		});

		resizeObserver.observe(wrapper);

		workerReady = initializeWorker(); // Создаем воркер

		return () => {
			resizeObserver.disconnect();
			worker?.terminate();
			worker = null;
			workerReady = null;
			sm?.dispose();
			sm = null;
		};
	});

	function handleDragEnter() {
		droparea = true;
	}
</script>

<svelte:body on:dragenter|self={handleDragEnter} on:dragleave={() => (droparea = false)} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="wrapper" bind:this={wrapper}>
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="viewfield"
		bind:this={viewField}
		on:drop={handlerDrop}
		on:dragover={(e) => e.preventDefault()}
		on:dragleave={() => (droparea = true)}
	>
		<!-- {#if !modelGeometry}
		<div class="empty">
			<div class="filechoose">
				<label for="myfile" class="choose">Выберите файлы</label>
				<input type="file" multiple="multiple" accept=".stl" bind:this={uploadButton}/>
			</div>
		</div>
		
	{:else} -->
		<div class="viewer" bind:this={viewer}>
			<div class="loader">
				{#if spinner}
					<div class="spinner"></div>
				{/if}
			</div>
		</div>

		{#if droparea}
			<div class="dropwrapper" transition:fade={{ delay: 100, duration: 200 }}>
				<div class="droparea">ПЕРЕТАЩИТЕ ФАЙЛЫ СЮДА</div>
			</div>
		{/if}

		<!-- <div class="checkfield">

			{#if enMeshVisibleButton}
				<input class="button" type="checkbox" title="Включить текстуры" bind:checked={enMeshVisible} on:change={colorChange}/>
			{/if}

			{#if enMeshColorPicker} 
				<input class="colorpicker" type="color" title="Цвет модели" bind:value={meshColor} on:change={colorChange}/>
			{/if}

			{#if enSkeletonVisibleButton}
				<input class="button" type="checkbox" title="Включить скелет" bind:checked={enSkeletonVisible} on:change={colorChange}/>
			{/if}

			{#if enSkeletonColorPicker} 
				<input class="colorpicker" type="color" title="Цвет скелета" bind:value={skeletonColor} on:change={colorChange}/>
			{/if}
			<div class="button"></div>
		</div> -->

		<!-- {/if} -->
	</div>
</div>

<style>
	.dropwrapper {
		position: absolute;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(28, 30, 32, 0.5);
	}

	.droparea {
		width: calc(100% - 20px);
		height: calc(100% - 20px);
		border-radius: 15px;
		border: 6px dotted #b5bac1;

		align-content: center;
		text-align: center;
		color: #b5bac1;
		user-select: none;
		font-family: 'PT Sans', sans-serif;
		font-weight: 550;
		font-size: 60px;

		z-index: 2;
	}

	.loader {
		position: absolute;
		/* visibility: hidden; */
		top: 50%;
		left: 50%;
		width: 2px;
		height: 2px;
		transform: translate(-50%, -50%);
	}

	.spinner {
		position: absolute;
		top: 50%;
		left: 50%;
		color: #fff;
		font-size: 10px;
		width: 1em;
		height: 1em;
		border-radius: 50%;
		position: relative;
		text-indent: -9999em;
		animation: mulShdSpin 1.3s infinite linear;
		transform: translateZ(0);
	}

	@keyframes mulShdSpin {
		0%,
		100% {
			box-shadow:
				0 -3em 0 0.2em,
				2em -2em 0 0em,
				3em 0 0 -1em,
				2em 2em 0 -1em,
				0 3em 0 -1em,
				-2em 2em 0 -1em,
				-3em 0 0 -1em,
				-2em -2em 0 0;
		}
		12.5% {
			box-shadow:
				0 -3em 0 0,
				2em -2em 0 0.2em,
				3em 0 0 0,
				2em 2em 0 -1em,
				0 3em 0 -1em,
				-2em 2em 0 -1em,
				-3em 0 0 -1em,
				-2em -2em 0 -1em;
		}
		25% {
			box-shadow:
				0 -3em 0 -0.5em,
				2em -2em 0 0,
				3em 0 0 0.2em,
				2em 2em 0 0,
				0 3em 0 -1em,
				-2em 2em 0 -1em,
				-3em 0 0 -1em,
				-2em -2em 0 -1em;
		}
		37.5% {
			box-shadow:
				0 -3em 0 -1em,
				2em -2em 0 -1em,
				3em 0em 0 0,
				2em 2em 0 0.2em,
				0 3em 0 0em,
				-2em 2em 0 -1em,
				-3em 0em 0 -1em,
				-2em -2em 0 -1em;
		}
		50% {
			box-shadow:
				0 -3em 0 -1em,
				2em -2em 0 -1em,
				3em 0 0 -1em,
				2em 2em 0 0em,
				0 3em 0 0.2em,
				-2em 2em 0 0,
				-3em 0em 0 -1em,
				-2em -2em 0 -1em;
		}
		62.5% {
			box-shadow:
				0 -3em 0 -1em,
				2em -2em 0 -1em,
				3em 0 0 -1em,
				2em 2em 0 -1em,
				0 3em 0 0,
				-2em 2em 0 0.2em,
				-3em 0 0 0,
				-2em -2em 0 -1em;
		}
		75% {
			box-shadow:
				0em -3em 0 -1em,
				2em -2em 0 -1em,
				3em 0em 0 -1em,
				2em 2em 0 -1em,
				0 3em 0 -1em,
				-2em 2em 0 0,
				-3em 0em 0 0.2em,
				-2em -2em 0 0;
		}
		87.5% {
			box-shadow:
				0em -3em 0 0,
				2em -2em 0 -1em,
				3em 0 0 -1em,
				2em 2em 0 -1em,
				0 3em 0 -1em,
				-2em 2em 0 0,
				-3em 0em 0 0,
				-2em -2em 0 0.2em;
		}
	}

	.wrapper {
		display: flex;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.viewer {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.viewfield {
		height: 100%;
		width: 100%;
		min-height: 0;
		display: flex;
		justify-content: center;
		align-content: center;
		position: relative;
		overflow: hidden;
	}

	.viewer :global(canvas) {
		display: block;
	}

	.checkfield {
		display: flex;
		flex-direction: column;
		align-items: end;
		position: absolute;
		right: 25px;
		top: 25px;
		height: 300px;
		width: 100px;
	}

	.colorpicker {
		margin-bottom: 14px;
		right: 0px;
		height: 30px;
		width: 30px;
		border-radius: 5px;
		border-color: #1a1b1e;
		padding: 0px;
		border: none;
	}

	input[type='checkbox'] {
		display: none;
	}

	input[type='checkbox'] {
		color: #f2f2f2;
	}

	input[type='checkbox'] {
		display: block;
		height: 30px;
		width: 30px;
		right: 0px;
		margin: 0px;
		margin-bottom: 14px;
		border-radius: 5px;
		/* margin:-2px 10px 0 0; */
		/* vertical-align:middle; */
		background-image: url('skeleton.svg');
		cursor: pointer;
	}

	input[type='checkbox']:checked {
		background-image: url('skeleton.svg');
	}

	input[type='color']::-webkit-color-swatch {
		border-radius: 5px;
		border-color: black;
		border-width: 1.4px;

		background-image: url('color.svg');
		background-size: 20px;
		background-repeat: no-repeat;
		background-position: center;
		cursor: pointer;
	}

	input[type='color']::-webkit-color-swatch:hover {
		box-shadow: 0px 0px 10px 0px rgba(0, 0, 0, 0.5);
	}

	input[type='color']::-webkit-color-swatch-wrapper {
		padding: 0;
		border-radius: 10px;
	}
</style>
