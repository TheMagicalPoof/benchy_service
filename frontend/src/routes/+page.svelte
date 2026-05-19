<script>
	import { fade } from 'svelte/transition';
	import MeshTreeNode from '../lib/MeshTreeNode.svelte';
	import StlViewer from '../lib/StlViewer.svelte';

	const supportedExtensions = [
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
	const accept = supportedExtensions.join(',');
	const stlUnitOptions = [
		{ value: 'mm', label: 'Millimeter', scale: 1 },
		{ value: 'cm', label: 'Centimeter', scale: 10 },
		{ value: 'm', label: 'Meter', scale: 1000 }
	];
	const defaultSsaoSettings = {
		enabled: true,
		strength: 0.63,
		power: 0.8,
		radiusScale: 0.08,
		minDistance: 0,
		maxDistance: 0.2
	};
	const exportOptions = [
		{ format: 'glb', label: 'glTF Binary (.glb)' },
		{ format: 'gltf', label: 'glTF Text (.gltf)' },
		{ format: 'obj', label: 'Wavefront (.obj)' },
		{ format: 'stl-ascii', label: 'Stereolithography Text (.stl)' },
		{ format: 'stl-binary', label: 'Stereolithography Binary (.stl)' },
		{ format: 'ply-ascii', label: 'Polygon File Format Text (.ply)' },
		{ format: 'ply-binary', label: 'Polygon File Format Binary (.ply)' },
		{ format: 'off', label: 'Object File Format Text (.off)' },
		{ format: '3dm', label: 'Rhinoceros 3D (.3dm)' },
		{ format: 'bim', label: 'Dotbim (.bim)' }
	];

	let activeItem = -1;
	let fileInput;
	let items = [];
	let viewer;
	let explorer;
	let meshList;
	let isOverlayActive = false;
	let modelStats = null;
	let selectionStats = null;
	let modelTree = null;
	let expandedTreeItems = new Set();
	let selectedMeshId = '';
	let selectedNodeId = '';
	let selectedMeshIds = [];
	let meshFocusEnabled = false;
	let selectionDetailsRequestId = 0;
	let meshSearch = '';
	let searchFocusSignature = '';
	let loadError = '';
	let projectionMode = 'perspective';
	let exportMenuOpen = false;
	let isExporting = false;
	let displayState = {
		solid: true,
		wire: false,
		skeleton: false,
		ghost: false
	};
	let backfaceCulling = false;
	let vertexColorsEnabled = true;
	let stlUnit = 'mm';

	$: activeFile = activeItem >= 0 ? items[activeItem] : null;
	$: activeFileName = activeFile?.name || 'No model loaded';
	$: activeFileSize = activeFile ? formatFileSize(activeFile.size) : '';
	$: snapshotReady = Boolean(activeFile && modelTree?.tree);
	$: meshTreeCount = modelTree?.meshCount ?? modelStats?.meshes?.length ?? 0;
	$: meshTreeRoots = getMeshTreeRoots(modelTree?.tree);
	$: expandableTreeItems = modelTree?.tree ? collectExpandableTreeIds(modelTree.tree) : new Set();
	$: isFullTreeExpanded =
		expandableTreeItems.size > 0 &&
		Array.from(expandableTreeItems).every((nodeId) => expandedTreeItems.has(nodeId));
	$: hiddenMeshIds = collectHiddenMeshIds(modelTree?.tree);
	$: filteredMeshTreeRoots = filterMeshTreeRoots(meshTreeRoots, meshSearch, selectedMeshId);
	$: syncSearchFocus(meshSearch, filteredMeshTreeRoots);
	$: activeIsStl = activeFile ? activeFile.name.toLowerCase().endsWith('.stl') : false;
	$: selectedStlUnit = stlUnitOptions.find((option) => option.value === stlUnit) || stlUnitOptions[0];
	$: activeUnitLabel = activeIsStl ? selectedStlUnit.label : modelStats?.unitLabel || 'Millimeter';
	$: displayLinearUnit = activeIsStl ? selectedStlUnit.value : 'mm';
	$: displayLinearDivisor = activeIsStl ? selectedStlUnit.scale : 1;
	$: detailsStats = selectionStats || modelStats;
	$: detailsUnitLabel = activeIsStl ? selectedStlUnit.label : detailsStats?.unitLabel || activeUnitLabel;
	$: detailsVolumeCm3 = Number.isFinite(detailsStats?.printVolumeCm3)
		? detailsStats.printVolumeCm3
		: detailsStats?.volumeCm3;
	$: detailsVolumePending = Boolean(
		detailsStats?.isSelectionPending ||
			detailsStats?.isPrintVolumePending ||
			(!Number.isFinite(detailsVolumeCm3) && detailsStats?.isVolumePending)
	);
	$: detailsSurfacePending = Boolean(
		detailsStats?.isSelectionPending || detailsStats?.isVolumePending
	);
	$: if (viewer) viewer.setSsaoSettings(defaultSsaoSettings);

	function chooseFiles() {
		fileInput?.click();
	}

	function uploadHandler(event) {
		event.preventDefault();
		fileUploader(event.target.files);
		event.target.value = '';
	}

	function dropHandler(event) {
		event.preventDefault();
		isOverlayActive = false;

		if (event.dataTransfer?.files) {
			fileUploader(event.dataTransfer.files);
			return;
		}

		if (event.detail?.files) {
			fileUploader(event.detail.files);
		}
	}

	function fileUploader(fileList) {
		const nextFiles = Array.from(fileList).filter(isSupportedFile);
		if (nextFiles.length === 0) return;

		let nextActiveIndex = activeItem;
		let addedNewFile = false;
		for (const file of nextFiles) {
			const existingIndex = items.findIndex((item) => isSameFileEntry(item, file));
			if (existingIndex >= 0) {
				nextActiveIndex = existingIndex;
				continue;
			}

			items.push(file);
			nextActiveIndex = items.length - 1;
			addedNewFile = true;
		}

		items = [...items];
		if (nextActiveIndex !== activeItem || addedNewFile) {
			itemSelect(nextActiveIndex);
		}
		requestAnimationFrame(() => {
			if (!explorer) return;
			if (addedNewFile) {
				explorer.scrollTo(0, explorer.scrollHeight);
				return;
			}
			explorer.querySelector(`[data-file-index="${nextActiveIndex}"]`)?.scrollIntoView({
				block: 'nearest'
			});
		});
	}

	function isSameFileEntry(left, right) {
		return left?.name === right?.name && left?.size === right?.size;
	}

	async function itemSelect(index) {
		if (!viewer || !items[index]) return;

		activeItem = index;
		resetModelUiState();
		projectionMode = 'perspective';
		await viewer.renderFile(items[index], { analysisOptions: getAnalysisOptions(items[index]) });
	}

	async function removeFile(index, event) {
		event?.stopPropagation();
		if (index < 0 || index >= items.length) return;

		const wasActive = index === activeItem;
		const wasBeforeActive = index < activeItem;
		items = items.filter((_, itemIndex) => itemIndex !== index);

		if (items.length === 0) {
			activeItem = -1;
			resetModelUiState();
			projectionMode = 'perspective';
			viewer?.clearModel();
			return;
		}

		if (wasActive) {
			await itemSelect(Math.min(index, items.length - 1));
			return;
		}

		if (wasBeforeActive) {
			activeItem -= 1;
		}
	}

	function handleFileRowKeyDown(event, index) {
		if (!['Enter', ' '].includes(event.key)) return;
		event.preventDefault();
		itemSelect(index);
	}

	function resetModelUiState() {
		modelStats = null;
		selectionStats = null;
		modelTree = null;
		expandedTreeItems = new Set();
		selectedMeshId = '';
		selectedNodeId = '';
		selectedMeshIds = [];
		meshFocusEnabled = false;
		selectionDetailsRequestId += 1;
		meshSearch = '';
		searchFocusSignature = '';
		loadError = '';
	}

	function isSupportedFile(file) {
		const fileName = file.name.toLowerCase();
		return supportedExtensions.some((ext) => fileName.endsWith(ext));
	}

	function handleDragEnter() {
		isOverlayActive = true;
	}

	function handleDragLeave(event) {
		event.preventDefault();
		isOverlayActive = false;
	}

	function handleModelStats(event) {
		if (!activeFile || event.detail.fileName !== activeFile.name) return;

		modelStats = mergeModelStats(modelStats, event.detail);
		loadError = '';
	}

	function handleSelectionDetails(event) {
		if (!activeFile || event.detail.fileName !== activeFile.name) return;
		if (event.detail.selectionRequestId !== selectionDetailsRequestId) return;

		selectionStats = {
			...mergeModelStats(selectionStats, event.detail),
			isSelectionPending: false
		};
	}

	function handleModelTree(event) {
		if (!activeFile || event.detail.fileName !== activeFile.name) return;

		modelTree = {
			tree: event.detail.tree,
			meshCount: event.detail.meshCount || 0
		};
		expandedTreeItems = collectExpandableTreeIds(modelTree.tree);
	}

	function mergeModelStats(previous, next) {
		const merged = {
			...(previous || {}),
			...next,
			size: {
				...(previous?.size || {}),
				...(next.size || {})
			}
		};

		for (const field of [
			'volume',
			'volumeMm3',
			'volumeCm3',
			'surfaceArea',
			'surfaceAreaMm2',
			'surfaceAreaCm2',
			'printVolumeMm3',
			'printVolumeCm3'
		]) {
			if (!Number.isFinite(next[field]) && Number.isFinite(previous?.[field])) {
				merged[field] = previous[field];
			}
		}

		const isFullStats = next.statsStage === 'full' || next.statsStage === 'selection-full';
		const isPrintStats = next.statsStage === 'print' || next.statsStage === 'selection-print';
		const hasVolume = Number.isFinite(merged.volumeCm3);
		merged.isVolumePending = isFullStats ? false : !hasVolume;
		const hasPrintVolume = Number.isFinite(merged.printVolumeCm3);
		merged.isPrintVolumePending = isPrintStats ? false : !hasPrintVolume;

		return merged;
	}

	function handleModelLoadError(event) {
		if (!activeFile || event.detail.fileName !== activeFile.name) return;

		loadError = event.detail.message || 'Failed to load model.';
	}

	function collectExpandableTreeIds(node, result = new Set()) {
		if (!node) return result;
		if (node.children?.length) {
			result.add(node.id);
			for (const child of node.children) {
				collectExpandableTreeIds(child, result);
			}
		}
		return result;
	}

	function getMeshTreeRoots(root) {
		if (!root) return [];
		return root.children?.length ? root.children : [root];
	}

	function filterMeshTreeRoots(roots, query, selectedId) {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery && !selectedId) return roots;

		return roots
			.map((node) => filterMeshTreeNode(node, normalizedQuery, selectedId))
			.filter(Boolean);
	}

	function filterMeshTreeNode(node, query, selectedId) {
		if (!node) return null;

		const children = (node.children || [])
			.map((child) => filterMeshTreeNode(child, query, selectedId))
			.filter(Boolean);
		const selfMatches = query && node.name?.toLowerCase().includes(query);
		const selfSelected = node.kind === 'mesh' && node.meshId === selectedId;
		if (selfMatches) return node;

		const queryPasses = !query || selfMatches || children.length > 0;
		const selectionPasses = selectedId && (selfSelected || children.length > 0);

		if (!queryPasses && !selectionPasses) return null;

		return {
			...node,
			children
		};
	}

	function collectHiddenMeshIds(node, result = new Set()) {
		if (!node) return result;
		if (node.kind === 'mesh' && node.visible === false) result.add(node.meshId);
		for (const child of node.children || []) collectHiddenMeshIds(child, result);
		return result;
	}

	function syncSearchFocus(query, roots) {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery || !viewer || !modelTree?.tree) {
			searchFocusSignature = '';
			return;
		}

		const ids = Array.from(new Set((roots || []).flatMap(collectTreeMeshIds)));
		const signature = `${normalizedQuery}|${ids.join('|')}`;
		if (signature === searchFocusSignature) return;

		searchFocusSignature = signature;
		if (ids.length === 0) return;

		const matchedNode = findFirstMatchingTreeNode(roots, normalizedQuery);
		selectedMeshId = ids[0];
		selectedMeshIds = ids;
		selectedNodeId =
			matchedNode?.id || (roots.length === 1 ? roots[0].id : findTreeNodeByMeshId(modelTree.tree, ids[0])?.id || '');
		expandedTreeItems = collectExpandableTreeIds({ children: roots });
		meshFocusEnabled = true;
		prepareMeshFocusDisplayState();
		viewer?.focusMeshes(ids, { skeleton: true });
		scrollSelectedTreeNode(selectedNodeId, selectedMeshId);
		requestSelectionDetails(ids);
	}

	function findFirstMatchingTreeNode(nodes, query) {
		for (const node of nodes || []) {
			if (node.name?.toLowerCase().includes(query)) return node;
			const childMatch = findFirstMatchingTreeNode(node.children || [], query);
			if (childMatch) return childMatch;
		}
		return null;
	}

	function collectTreeMeshIds(node) {
		if (!node) return [];
		if (node.kind === 'mesh' && node.meshId) return [node.meshId];
		return (node.children || []).flatMap(collectTreeMeshIds);
	}

	function isWholeModelRootSelection(nodeId, meshIds) {
		if (!nodeId || !modelTree?.tree) return false;

		const rootNode = getMeshTreeRoots(modelTree.tree).find((node) => node.id === nodeId);
		if (!rootNode) return false;

		const selectedIds = new Set((meshIds || []).filter(Boolean));
		const allModelMeshIds = collectTreeMeshIds(modelTree.tree);
		if (selectedIds.size === 0 || selectedIds.size !== allModelMeshIds.length) return false;

		return allModelMeshIds.every((meshId) => selectedIds.has(meshId));
	}

	function toggleTreeNode(event) {
		const id = event.detail.id;
		const next = new Set(expandedTreeItems);

		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}

		expandedTreeItems = next;
	}

	function toggleAllTreeNodes() {
		if (!modelTree?.tree || expandableTreeItems.size === 0) return;

		expandedTreeItems = isFullTreeExpanded ? new Set() : new Set(expandableTreeItems);
		focusMeshList();
	}

	function changeMeshColor(event) {
		const { meshId, meshIds, color } = event.detail;
		const ids = Array.from(new Set((meshIds || [meshId]).filter(Boolean)));
		if (ids.length === 0 || !color || !modelTree?.tree) return;

		modelTree = {
			...modelTree,
			tree: updateTreeMeshColors(modelTree.tree, new Set(ids), color)
		};
		for (const id of ids) {
			viewer?.setMeshColor(id, color);
		}
	}

	function selectMeshFromTree(event) {
		const ids = event.detail.meshIds || [event.detail.meshId];
		if (isTreeSelectionActive(event.detail.nodeId, ids)) {
			clearMeshSelection();
			focusMeshList();
			return;
		}

		selectMeshesByIds(ids, {
			nodeId: event.detail.nodeId,
			syncViewer: true
		});
		focusMeshList();
	}

	function handleViewerMeshSelect(event) {
		const node = findTreeNodeByMeshId(modelTree?.tree, event.detail.meshId);
		meshFocusEnabled = true;
		prepareMeshFocusDisplayState();
		selectMeshesByIds([event.detail.meshId], {
			nodeId: node?.id || '',
			syncViewer: false,
			clearSearch: true
		});
	}

	function selectMeshesByIds(meshIds, { nodeId = '', syncViewer = true, clearSearch = false } = {}) {
		const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
		if (ids.length === 0 || !modelTree?.tree) return;

		if (clearSearch) meshSearch = '';
		selectedMeshId = ids[0];
		selectedMeshIds = ids;
		selectedNodeId = nodeId || findTreeNodeByMeshId(modelTree.tree, ids[0])?.id || '';
		expandedTreeItems = expandTreeToMeshes(modelTree.tree, new Set(ids), new Set(expandedTreeItems));
		const isWholeModelSelection = isWholeModelRootSelection(selectedNodeId, ids);
		if (syncViewer) {
			if (isWholeModelSelection) {
				meshFocusEnabled = false;
				viewer?.clearMeshFocus();
			} else {
				meshFocusEnabled = true;
				prepareMeshFocusDisplayState();
				viewer?.focusMeshes(ids, { skeleton: true });
			}
		}
		scrollSelectedTreeNode(selectedNodeId, selectedMeshId);
		if (isWholeModelSelection) {
			selectionStats = null;
			selectionDetailsRequestId += 1;
		} else {
			requestSelectionDetails(ids);
		}
	}

	function prepareMeshFocusDisplayState() {
		const nextState = {
			...displayState,
			solid: true,
			wire: false,
			ghost: false
		};

		if (
			nextState.solid === displayState.solid &&
			nextState.wire === displayState.wire &&
			nextState.ghost === displayState.ghost
		) {
			return;
		}

		displayState = nextState;
		viewer?.setDisplayState(displayState);
	}

	function isTreeSelectionActive(nodeId, meshIds) {
		const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
		if (!nodeId && ids.length === 0) return false;
		if (selectedNodeId) return selectedNodeId === nodeId;
		return ids.length === 1 && selectedMeshId === ids[0];
	}

	function clearMeshSelection() {
		selectedMeshId = '';
		selectedNodeId = '';
		selectedMeshIds = [];
		meshFocusEnabled = false;
		selectionStats = null;
		selectionDetailsRequestId += 1;
		viewer?.clearMeshFocus();
	}

	function requestSelectionDetails(meshIds) {
		const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
		selectedMeshIds = ids;
		selectionDetailsRequestId += 1;

		if (!activeFile || !viewer || ids.length === 0) {
			selectionStats = null;
			return;
		}

		const analysisOptions = getAnalysisOptions(activeFile);
		selectionStats = {
			fileName: activeFile.name,
			selectionRequestId: selectionDetailsRequestId,
			meshIds: ids,
			unitScale: analysisOptions.unitScale,
			unitLabel: analysisOptions.unitLabel,
			unitless: analysisOptions.unitless,
			isSelectionPending: true,
			isVolumePending: true,
			isPrintVolumePending: true,
			statsStage: 'selection-pending'
		};

		const request = viewer.requestSelectionDetails(ids, {
			selectionRequestId: selectionDetailsRequestId,
			analysisOptions
		});
		request?.catch?.((error) => {
			console.error('Failed to request selection details:', error);
		});
	}

	function handleMeshTreeKeyDown(event) {
		if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
		if (isTreeControlTarget(event.target)) return;

		const navigationItems = getVisibleTreeNavigationItems(filteredMeshTreeRoots, expandedTreeItems);
		if (navigationItems.length === 0) return;

		event.preventDefault();
		const currentIndex = navigationItems.findIndex((item) => item.nodeId === selectedNodeId);
		const selectedIndex = currentIndex >= 0
			? currentIndex
			: navigationItems.findIndex((item) => item.meshIds.includes(selectedMeshId));
		const fallbackIndex = event.key === 'ArrowDown' ? -1 : navigationItems.length;
		const nextIndex = clampIndex(
			(selectedIndex >= 0 ? selectedIndex : fallbackIndex) + (event.key === 'ArrowDown' ? 1 : -1),
			0,
			navigationItems.length - 1
		);
		const nextItem = navigationItems[nextIndex];

		selectMeshesByIds(nextItem.meshIds, {
			nodeId: nextItem.nodeId,
			syncViewer: true
		});
		focusMeshList();
	}

	function handleGlobalKeyDown(event) {
		if (event.key === 'Escape' && exportMenuOpen) {
			exportMenuOpen = false;
			return;
		}

		if (isTreeControlTarget(event.target)) return;
		if (!activeFile) return;

		if (isMeshFocusShortcut(event)) {
			if (!modelTree?.tree) return;
			event.preventDefault();
			toggleSelectedMeshFocus();
			return;
		}

		const axis = getAxisShortcut(event);
		if (axis) {
			event.preventDefault();
			setAxisView(axis);
		}
	}

	function isMeshFocusShortcut(event) {
		if (event.ctrlKey || event.altKey || event.metaKey) return false;
		return event.key === 'Enter' || event.key === ' ' || event.code === 'Space';
	}

	function getAxisShortcut(event) {
		if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return '';

		const key = event.key.toLowerCase();
		if (key === 'x' || key === 'y' || key === 'z') return key;
		return '';
	}

	function handleWindowClick() {
		closeExportMenu();
	}

	function toggleSelectedMeshFocus() {
		const ids = getSelectedMeshIds();
		if (ids.length === 0) return;

		if (isWholeModelRootSelection(selectedNodeId, ids)) {
			meshFocusEnabled = false;
			viewer?.clearMeshFocus();
			focusMeshList();
			return;
		}

		if (meshFocusEnabled) {
			meshFocusEnabled = false;
			viewer?.clearMeshFocus();
		} else {
			meshFocusEnabled = true;
			prepareMeshFocusDisplayState();
			viewer?.focusMeshes(ids, { skeleton: true });
		}

		focusMeshList();
	}

	function getSelectedMeshIds() {
		if (selectedMeshIds.length > 0) return selectedMeshIds;
		return selectedMeshId ? [selectedMeshId] : [];
	}

	function getVisibleTreeNavigationItems(nodes, expandedIds, result = []) {
		for (const node of nodes || []) {
			const meshIds = collectTreeMeshIds(node);
			if (meshIds.length > 0) {
				result.push({
					nodeId: node.id,
					meshIds
				});
			}

			if (node.children?.length && expandedIds.has(node.id)) {
				getVisibleTreeNavigationItems(node.children, expandedIds, result);
			}
		}
		return result;
	}

	function isTreeControlTarget(target) {
		return Boolean(target?.closest?.('input, select, textarea, button'));
	}

	function focusMeshList() {
		meshList?.focus?.({ preventScroll: true });
		requestAnimationFrame(() => {
			meshList?.focus?.({ preventScroll: true });
		});
	}

	function clampIndex(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function changeMeshVisibility(event) {
		const { meshId, meshIds, visible } = event.detail;
		setMeshesVisibility(meshIds || [meshId], visible, {
			syncViewer: true,
			updateSelection: false,
			expandTree: false,
			scrollTree: false
		});
	}

	function handleViewerMeshVisibility(event) {
		const { meshId, visible } = event.detail;
		setMeshesVisibility([meshId], visible, { syncViewer: false, clearSearch: true });
	}

	function setMeshesVisibility(
		meshIds,
		visible,
		{ syncViewer = true, clearSearch = false, updateSelection = true, expandTree = true, scrollTree = true } = {}
	) {
		const ids = Array.from(new Set((meshIds || []).filter(Boolean)));
		if (ids.length === 0 || !modelTree?.tree) return;

		if (clearSearch) meshSearch = '';
		modelTree = {
			...modelTree,
			tree: updateTreeMeshesVisibility(modelTree.tree, new Set(ids), visible)
		};

		if (syncViewer) viewer?.setMeshesVisibility(ids, visible);
		if (updateSelection && !visible && !ids.includes(selectedMeshId)) {
			selectedMeshId = ids[0];
			selectedNodeId = findTreeNodeByMeshId(modelTree.tree, ids[0])?.id || '';
		}
		if (expandTree) {
			expandedTreeItems = expandTreeToMeshes(modelTree.tree, new Set(ids), new Set(expandedTreeItems));
		}
		if (scrollTree) {
			scrollSelectedTreeNode(selectedNodeId, ids[0]);
		}
	}

	function updateTreeMeshColors(node, meshIds, color) {
		if (!node) return node;

		const children = node.children?.map((child) => updateTreeMeshColors(child, meshIds, color)) || [];
		if (node.kind === 'mesh' && meshIds.has(node.meshId)) {
			return {
				...node,
				color,
				children
			};
		}

		return {
			...node,
			children
		};
	}

	function updateTreeMeshesVisibility(node, meshIds, visible) {
		if (!node) return node;

		const children = node.children?.map((child) => updateTreeMeshesVisibility(child, meshIds, visible)) || [];
		if (node.kind === 'mesh' && meshIds.has(node.meshId)) {
			return {
				...node,
				visible,
				children
			};
		}

		return {
			...node,
			children
		};
	}

	function expandTreeToMeshes(node, meshIds, result) {
		if (!node) return result;
		if (treeContainsAnyMesh(node, meshIds)) {
			if (node.children?.length) result.add(node.id);
			for (const child of node.children || []) expandTreeToMeshes(child, meshIds, result);
		}
		return result;
	}

	function treeContainsAnyMesh(node, meshIds) {
		if (!node) return false;
		if (node.kind === 'mesh' && meshIds.has(node.meshId)) return true;
		return (node.children || []).some((child) => treeContainsAnyMesh(child, meshIds));
	}

	function findTreeNodeByMeshId(node, meshId) {
		if (!node || !meshId) return null;
		if (node.kind === 'mesh' && node.meshId === meshId) return node;
		for (const child of node.children || []) {
			const found = findTreeNodeByMeshId(child, meshId);
			if (found) return found;
		}
		return null;
	}

	function scrollSelectedTreeNode(nodeId, meshId) {
		requestAnimationFrame(() => {
			const nodeSelector = nodeId ? `.tree-row[data-node-id="${CSS.escape(nodeId)}"]` : '';
			const meshSelector = meshId ? `.mesh-row[data-mesh-id="${CSS.escape(meshId)}"]` : '';
			const row = nodeSelector
				? document.querySelector(nodeSelector)
				: meshSelector
					? document.querySelector(meshSelector)
					: null;
			row?.scrollIntoView({ block: 'nearest' });
		});
	}

	function fitModel() {
		viewer?.fitModel();
	}

	function resetView() {
		displayState = {
			solid: true,
			wire: false,
			skeleton: false,
			ghost: false
		};
		backfaceCulling = false;
		vertexColorsEnabled = true;
		projectionMode = 'perspective';
		selectedMeshId = '';
		selectedNodeId = '';
		selectedMeshIds = [];
		meshFocusEnabled = false;
		selectionStats = null;
		selectionDetailsRequestId += 1;
		meshSearch = '';
		searchFocusSignature = '';
		if (modelTree?.tree) {
			const meshIds = collectTreeMeshIds(modelTree.tree);
			const visibleTree = updateTreeMeshesVisibility(modelTree.tree, new Set(meshIds), true);
			modelTree = {
				...modelTree,
				tree: visibleTree
			};
			expandedTreeItems = collectExpandableTreeIds(visibleTree);
			viewer?.setMeshesVisibility(meshIds, true);
		}
		viewer?.clearMeshFocus();
		viewer?.setDisplayState(displayState);
		viewer?.setBackfaceCulling(backfaceCulling);
		viewer?.setVertexColorsEnabled(vertexColorsEnabled);
		viewer?.resetView();
		requestAnimationFrame(() => {
			document.querySelector('.mesh-list')?.scrollTo({ top: 0 });
		});
	}

	function setProjectionMode(mode) {
		projectionMode = mode === 'orthographic' ? 'orthographic' : 'perspective';
		viewer?.setProjectionMode(projectionMode);
	}

	function setAxisView(axis) {
		const axisViews = {
			x: 'right',
			y: 'front',
			z: 'top'
		};
		viewer?.setView(axisViews[axis] || 'front');
	}

	function setBaseDisplayMode(mode) {
		const isActive = mode === 'ghost' ? displayState.ghost : displayState.solid && !displayState.ghost;
		const nextState = {
			...displayState,
			solid: isActive ? false : true,
			ghost: isActive ? false : mode === 'ghost'
		};

		displayState = nextState;
		viewer?.setDisplayState(displayState);
	}

	function setOverlayDisplayMode(mode) {
		const isActive = Boolean(displayState[mode]);
		const nextState = {
			...displayState,
			wire: false,
			skeleton: false
		};

		if (!isActive) nextState[mode] = true;

		displayState = nextState;
		viewer?.setDisplayState(displayState);
	}

	function toggleBackfaceCulling() {
		backfaceCulling = !backfaceCulling;
		viewer?.setBackfaceCulling(backfaceCulling);
	}

	function toggleVertexColors() {
		vertexColorsEnabled = !vertexColorsEnabled;
		viewer?.setVertexColorsEnabled(vertexColorsEnabled);
	}

	function changeStlUnit(event) {
		stlUnit = event.target.value;
		if (!activeFile || !activeIsStl) return;

		modelStats = {
			...(modelStats || {}),
			isVolumePending: true,
			isPrintVolumePending: true
		};
		viewer?.reanalyzeCurrentModel(getAnalysisOptions(activeFile));
		if (selectedMeshIds.length > 0) requestSelectionDetails(selectedMeshIds);
	}

	function getAnalysisOptions(file = activeFile) {
		const isStl = file ? file.name.toLowerCase().endsWith('.stl') : false;
		const unit = isStl ? selectedStlUnit : stlUnitOptions[0];

		return {
			unitScale: unit.scale,
			unitLabel: unit.label,
			unitless: isStl,
			printLayerHeightMm: 0.2,
			printMaxLayers: 180,
			printScanlines: 72
		};
	}

	async function downloadSnapshot() {
		const blob = await viewer?.snapshotBlob?.();
		if (!blob) return;

		downloadBlob(blob, `${getActiveFileBaseName()}-snapshot.png`);
	}

	async function downloadExport(format, event) {
		event?.stopPropagation();
		if (!viewer || isExporting) return;

		exportMenuOpen = false;
		isExporting = true;

		try {
			const baseName = getActiveFileBaseName();
			const files = await viewer.exportModel(format, { baseName });

			for (const [index, file] of (files || []).entries()) {
				downloadBlob(file.blob, file.fileName || `${baseName}.${file.extension}`);
				if (index < files.length - 1) await waitForDownloadTick();
			}
		} catch (error) {
			console.error('Failed to export model:', error);
		} finally {
			isExporting = false;
		}
	}

	function toggleExportMenu(event) {
		event.stopPropagation();
		if (!snapshotReady || isExporting) return;
		exportMenuOpen = !exportMenuOpen;
	}

	function closeExportMenu() {
		exportMenuOpen = false;
	}

	function getActiveFileBaseName() {
		return activeFileName.replace(/\.[^.]+$/, '') || 'model';
	}

	function downloadBlob(blob, fileName) {
		if (!blob) return;

		const objectUrl = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
	}

	function waitForDownloadTick() {
		return new Promise((resolve) => setTimeout(resolve, 300));
	}

	function formatNumber(value, digits = 2) {
		if (!Number.isFinite(value)) return '-';

		return new Intl.NumberFormat('ru-RU', {
			maximumFractionDigits: digits
		}).format(value);
	}

	function formatMeasuredNumber(value, digits = 2) {
		if (!Number.isFinite(value)) return '-';

		const floor = 10 ** -digits;
		if (value !== 0 && Math.abs(value) < floor) {
			return `<${formatNumber(floor, digits)}`;
		}

		return formatNumber(value, digits);
	}

	function formatLinearSize(value) {
		if (!Number.isFinite(value)) return '-';
		return formatNumber(value / displayLinearDivisor);
	}

	function formatLinearSizeWithUnit(value) {
		const formatted = formatLinearSize(value);
		return formatted === '-' ? '-' : `${formatted} ${displayLinearUnit}`;
	}

	function formatVolumeCm3(value) {
		const formatted = formatMeasuredNumber(value, 3);
		return formatted === '-' ? '-' : `${formatted} cm3`;
	}

	function formatSurfaceCm2(value) {
		const formatted = formatNumber(value, 2);
		return formatted === '-' ? '-' : `${formatted} cm2`;
	}

	function formatInteger(value) {
		if (!Number.isFinite(value)) return '-';
		return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
	}

	function formatFileSize(bytes) {
		if (!Number.isFinite(bytes)) return '';
		if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
		return `${formatNumber(bytes / (1024 * 1024), 2)} MB`;
	}
</script>

<svelte:window on:keydown={handleGlobalKeyDown} on:click={handleWindowClick} />
<svelte:body on:dragenter|self={handleDragEnter} on:dragover={(event) => event.preventDefault()} />

<input
	class="hidden-input"
	type="file"
	multiple
	{accept}
	bind:this={fileInput}
	on:change={uploadHandler}
/>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="viewer-app" on:drop={dropHandler} on:dragover={(event) => event.preventDefault()}>
	<header class="app-header">
		<div class="brand">
			<div class="brand-mark" aria-hidden="true">
				<svg viewBox="0 0 24 24">
					<path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" />
					<path d="m12 12 9-5M12 12 3 7M12 12v10" />
				</svg>
			</div>
			<div>
				<div class="brand-title">3D Viewer</div>
			</div>
		</div>
		<a
			class="creator-link"
			href="https://magicalpoof.ru"
			target="_blank"
			rel="noopener noreferrer"
			>By Magical_PooF</a
		>
	</header>

	<div class="toolbar" aria-label="Viewer toolbar">
		<div class="tool-group">
			<button
				class="tool-button primary"
				type="button"
				title="Open from your device"
				on:click={chooseFiles}
			>
				<svg viewBox="0 0 24 24"><path d="M12 4v12M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>
				Open
			</button>
		</div>

		<div class="tool-separator"></div>

		<div class="tool-group">
			<button
				class="icon-button"
				type="button"
				title="Fit model to window"
				disabled={!activeFile}
				on:click={fitModel}
			>
				<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
			</button>
			<button
				class="icon-button"
				type="button"
				title="Reset view"
				disabled={!activeFile}
				on:click={resetView}
			>
				<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v6h6" /></svg>
			</button>
		</div>

		<div class="tool-group segmented projection-toggle" aria-label="Camera projection">
			<button
				class:selected={projectionMode === 'perspective'}
				type="button"
				title="Perspective camera"
				aria-pressed={projectionMode === 'perspective'}
				disabled={!activeFile}
				on:click={() => setProjectionMode('perspective')}
			>
				<svg viewBox="0 0 24 24">
					<path d="M4 7h16l-4 10H8L4 7Z" />
					<path d="M4 7l8 5 8-5M8 17l4-5 4 5" />
				</svg>
			</button>
			<button
				class:selected={projectionMode === 'orthographic'}
				type="button"
				title="Orthographic camera"
				aria-pressed={projectionMode === 'orthographic'}
				disabled={!activeFile}
				on:click={() => setProjectionMode('orthographic')}
			>
				<svg viewBox="0 0 24 24">
					<path d="M7 7h10v10H7V7Z" />
					<path d="M10 4h10v10M17 7l3-3M17 17l3-3M7 7l3-3" />
				</svg>
			</button>
		</div>

		<div class="tool-group segmented">
			<button
				class:selected={displayState.solid && !displayState.ghost}
				type="button"
				disabled={!activeFile}
				on:click={() => setBaseDisplayMode('solid')}>Solid</button
			>
			<button
				class:selected={displayState.ghost}
				type="button"
				disabled={!activeFile}
				on:click={() => setBaseDisplayMode('ghost')}>Ghost</button
			>
		</div>

		<div class="tool-group segmented">
			<button
				class:selected={displayState.skeleton}
				type="button"
				disabled={!activeFile}
				on:click={() => setOverlayDisplayMode('skeleton')}>Skeleton</button
			>
			<button
				class:selected={displayState.wire}
				type="button"
				disabled={!activeFile}
				on:click={() => setOverlayDisplayMode('wire')}>Wire</button
			>
		</div>

		<div class="tool-group material-toggles">
			<button
				class="icon-button backface-toggle"
				class:selected={backfaceCulling}
				type="button"
				title="Backface culling"
				aria-pressed={backfaceCulling}
				disabled={!activeFile}
				on:click={toggleBackfaceCulling}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 8.5 12 4.5l7 4-7 4-7-4Z" />
					<path d="M6.5 13.2 12 16.4l5.5-3.2" />
					<path d="M12 12.5v6.5" />
					<path d="m9.5 16.5 2.5 2.5 2.5-2.5" />
				</svg>
			</button>
			<button
				class="icon-button vertex-color-toggle"
				class:selected={vertexColorsEnabled}
				type="button"
				title={vertexColorsEnabled ? 'Disable vertex colors' : 'Enable vertex colors'}
				aria-pressed={vertexColorsEnabled}
				disabled={!activeFile}
				on:click={toggleVertexColors}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path class="vertex-color-edge" d="M12 5.2 5.8 17.5h12.4L12 5.2Z" />
					<circle class="vertex-color-red" cx="12" cy="5.2" r="1.7" />
					<circle class="vertex-color-green" cx="5.8" cy="17.5" r="1.7" />
					<circle class="vertex-color-blue" cx="18.2" cy="17.5" r="1.7" />
					{#if !vertexColorsEnabled}
						<path class="vertex-color-slash" d="M5 19 19 5" />
					{/if}
				</svg>
			</button>
		</div>

		<div class="tool-spacer"></div>

		<div class="tool-dropdown">
			<button
				class="tool-button export-button"
				type="button"
				title="Export model"
				aria-haspopup="menu"
				aria-expanded={exportMenuOpen}
				disabled={!snapshotReady || isExporting}
				on:click={toggleExportMenu}
			>
				<svg viewBox="0 0 24 24">
					<path d="M12 4v11" />
					<path d="M7 10l5 5 5-5" />
					<path d="M5 20h14" />
				</svg>
				Export
			</button>
			{#if exportMenuOpen}
				<div class="export-menu" role="menu">
					{#each exportOptions as option}
						<button type="button" role="menuitem" on:click={(event) => downloadExport(option.format, event)}>
							{option.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<button
			class="icon-button snapshot-button"
			type="button"
			title="Create snapshot"
			disabled={!snapshotReady}
			on:click={downloadSnapshot}
		>
			<svg viewBox="0 0 24 24"
				><path d="M8 7h8l1 3h3v10H4V10h3l1-3Z" /><circle cx="12" cy="15" r="3" /></svg
			>
		</button>
	</div>

	<main class="workspace">
		<aside class="left-panel">
			<div class="panel-content">
				<section class="navigator-section">
					<div class="panel-title">Files</div>
					<div class="file-list" bind:this={explorer}>
						{#if items.length === 0}
							<button class="empty-file-button" type="button" on:click={chooseFiles}
								>Open model file</button
							>
						{/if}
						{#each items as item, index (item.name + item.size)}
							<div
								class="tree-row file-row"
								class:active={index === activeItem}
								data-file-index={index}
								role="button"
								tabindex="0"
								title={item.name}
								on:click={() => itemSelect(index)}
								on:keydown={(event) => handleFileRowKeyDown(event, index)}
							>
								<span class="row-name">{item.name}</span>
								<button
									class="file-close-button"
									type="button"
									title="Close file"
									aria-label={`Close ${item.name}`}
									on:click={(event) => removeFile(index, event)}
								>
									<svg viewBox="0 0 18 18" aria-hidden="true">
										<path d="M5 5l8 8M13 5l-8 8" />
									</svg>
								</button>
							</div>
						{/each}
					</div>
				</section>

				<section class="navigator-section mesh-section">
					<div class="mesh-header">
						<div class="panel-title row-title">
							<div class="mesh-title-actions">
								<span>Meshes</span>
								<button
									class="mesh-tree-toggle"
									type="button"
									title={isFullTreeExpanded ? 'Collapse all' : 'Expand all'}
									aria-label={isFullTreeExpanded ? 'Collapse all meshes' : 'Expand all meshes'}
									aria-pressed={isFullTreeExpanded}
									disabled={expandableTreeItems.size === 0}
									on:click={toggleAllTreeNodes}
								>
									<svg viewBox="0 0 24 24" aria-hidden="true">
										{#if isFullTreeExpanded}
											<path d="M7 10h10M7 14h10" />
											<path d="m9 5 3 3 3-3M15 19l-3-3-3 3" />
										{:else}
											<path d="M7 10h10M7 14h10" />
											<path d="m9 8 3-3 3 3M15 16l-3 3-3-3" />
										{/if}
									</svg>
								</button>
							</div>
							<span>{meshTreeCount}</span>
						</div>
					</div>
					<div
						class="mesh-list"
						bind:this={meshList}
						tabindex="0"
						role="tree"
						aria-label="Meshes"
						on:keydown={handleMeshTreeKeyDown}
					>
						{#if !modelTree?.tree}
							<div class="muted-row">No mesh data</div>
						{:else if meshTreeCount === 0}
							<div class="muted-row">No meshes</div>
						{:else if filteredMeshTreeRoots.length === 0}
							<div class="muted-row">No matches</div>
						{:else}
							{#each filteredMeshTreeRoots as treeNode (treeNode.id)}
								<MeshTreeNode
									node={treeNode}
									expandedIds={expandedTreeItems}
									{selectedMeshId}
									{selectedNodeId}
									{hiddenMeshIds}
									on:toggle={toggleTreeNode}
									on:color={changeMeshColor}
									on:select={selectMeshFromTree}
									on:visible={changeMeshVisibility}
								/>
							{/each}
						{/if}
					</div>
				</section>
			</div>
		</aside>

		<section class="viewer-stage">
			<div class="viewfield">
				<StlViewer
					bind:this={viewer}
					enDrop={false}
					on:modelstats={handleModelStats}
					on:selectiondetails={handleSelectionDetails}
					on:modeltree={handleModelTree}
					on:modelloaderror={handleModelLoadError}
					on:meshselect={handleViewerMeshSelect}
					on:meshvisibility={handleViewerMeshVisibility}
				/>

				{#if !activeFile}
					<div class="intro" transition:fade={{ duration: 180 }}>
						<div class="intro-mark">
							<svg viewBox="0 0 24 24">
								<path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" />
								<path d="m12 12 9-5M12 12 3 7M12 12v10" />
							</svg>
						</div>
						<div class="intro-title">Drop 3D models here</div>
						<div class="intro-subtitle">
							Supported: 3DM, 3DS, 3MF, AMF, BIM, BREP, DAE, FBX, FCStd, GLTF, IFC,
							IGES, OBJ, OFF, PLY, STL, STEP, WRL
						</div>
						<button type="button" on:click={chooseFiles}>Open from device</button>
					</div>
				{/if}
				{#if activeFile && loadError}
					<div class="load-error" transition:fade={{ duration: 180 }}>
						<div class="load-error-title">Unable to open this model</div>
						<div class="load-error-text">{loadError}</div>
					</div>
				{/if}
			</div>
		</section>

		<aside class="right-panel">
			<div class="details-content">
				<section class="details-section">
					<div class="panel-title">Details</div>
					<div class="property-table">
						<div class="property-row">
							<span>Vertices:</span
							><strong>{detailsStats?.isSelectionPending ? '-' : formatInteger(detailsStats?.vertices)}</strong>
						</div>
						<div class="property-row">
							<span>Triangles:</span
							><strong>{detailsStats?.isSelectionPending ? '-' : formatInteger(detailsStats?.triangles)}</strong>
						</div>
						<div class="property-row">
							<span>File size:</span><strong>{activeFileSize || '-'}</strong>
						</div>
						<div class="property-row">
							<span>Unit:</span>
							<strong>
								{#if activeIsStl}
									<select class="unit-select" bind:value={stlUnit} on:change={changeStlUnit}>
										{#each stlUnitOptions as option}
											<option value={option.value}>{option.label}</option>
										{/each}
									</select>
								{:else}
									{activeFile ? detailsUnitLabel : '-'}
								{/if}
							</strong>
						</div>
						<div class="property-row">
							<span>Size X:</span
							><strong
								>{detailsStats?.isSelectionPending
									? '-'
									: formatLinearSizeWithUnit(detailsStats?.size?.x)}</strong
							>
						</div>
						<div class="property-row">
							<span>Size Y:</span
							><strong
								>{detailsStats?.isSelectionPending
									? '-'
									: formatLinearSizeWithUnit(detailsStats?.size?.y)}</strong
							>
						</div>
						<div class="property-row">
							<span>Size Z:</span
							><strong
								>{detailsStats?.isSelectionPending
									? '-'
									: formatLinearSizeWithUnit(detailsStats?.size?.z)}</strong
							>
						</div>
						<div class="property-row">
							<span>Volume:</span
							><strong>{detailsVolumePending ? '-' : formatVolumeCm3(detailsVolumeCm3)}</strong>
						</div>
						<div class="property-row">
							<span>Surface:</span
							><strong
								>{detailsSurfacePending ? '-' : formatSurfaceCm2(detailsStats?.surfaceAreaCm2)}</strong
							>
						</div>
					</div>
				</section>
			</div>
		</aside>
	</main>

	{#if isOverlayActive}
		<div class="dropwrapper" transition:fade={{ delay: 80, duration: 160 }}>
			<div class="droparea">Drop files to open</div>
		</div>
	{/if}
</div>

{#if isOverlayActive}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="overlay"
		transition:fade={{ duration: 180 }}
		on:dragleave={handleDragLeave}
		on:drop={handleDragLeave}
	/>
{/if}

<svelte:head>
	<link
		href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;500;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		overflow: hidden;
		background-color: #232428;
	}

	:global(button),
	:global(input),
	:global(select) {
		font: inherit;
		color: inherit;
	}

	.hidden-input {
		position: fixed;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.viewer-app {
		position: relative;
		display: grid;
		width: 100vw;
		height: 100vh;
		grid-template-rows: 52px auto minmax(0, 1fr);
		background-color: #2b2d31;
		color: #d7dce3;
		font-family: 'PT Sans', system-ui, sans-serif;
		letter-spacing: 0;
	}

	.app-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		border-bottom: 1px solid #3b3d43;
		background-color: #282a2f;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding-left: 12px;
	}

	.brand-mark {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		color: #69b7e8;
	}

	.brand-mark svg,
	.intro-mark svg,
	.tool-button svg,
	.icon-button svg,
	.projection-toggle svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.brand-title {
		color: #f0f4f8;
		font-size: 23px;
		font-weight: 700;
		line-height: 26px;
	}

	.creator-link {
		justify-self: end;
		margin-right: 14px;
		border: 0;
		background: transparent;
		color: #8f98a6;
		font-size: 13px;
		font-weight: 500;
		line-height: 28px;
		text-decoration: none;
		padding: 0;
		white-space: nowrap;
	}

	.creator-link:hover {
		color: #c5ccd6;
	}

	.toolbar {
		display: flex;
		min-height: 42px;
		align-items: center;
		align-content: center;
		flex-wrap: wrap;
		gap: 8px;
		border-bottom: 1px solid #3b3d43;
		background-color: #37393f;
		padding: 5px 10px;
	}

	.tool-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tool-button,
	.icon-button,
	.segmented button,
	.intro button,
	.empty-file-button {
		border: 1px solid #50535b;
		background-color: #3e4148;
		color: #dbe1e8;
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.tool-button:hover,
	.icon-button:hover,
	.segmented button:hover,
	.intro button:hover,
	.empty-file-button:hover {
		border-color: #6f7784;
		background-color: #4a4e57;
	}

	.tool-button:disabled,
	.icon-button:disabled,
	.segmented button:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.tool-button {
		display: flex;
		height: 30px;
		align-items: center;
		gap: 7px;
		border-radius: 5px;
		padding: 0 10px;
		font-size: 14px;
		font-weight: 700;
	}

	.tool-button svg {
		width: 18px;
		height: 18px;
	}

	.tool-button.primary {
		border-color: #5d7f99;
		background-color: #3b5f78;
	}

	.export-button {
		padding-right: 11px;
	}

	.icon-button {
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border-radius: 5px;
		padding: 6px;
	}

	.snapshot-button {
		padding: 3px;
	}

	.tool-dropdown {
		position: relative;
		display: grid;
	}

	.export-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 30;
		display: grid;
		min-width: 260px;
		overflow: hidden;
		border: 1px solid #59616d;
		border-radius: 5px;
		background-color: #303238;
		box-shadow: 0 14px 28px rgba(0, 0, 0, 0.26);
	}

	.export-menu button {
		height: 30px;
		border: 0;
		border-bottom: 1px solid #454a53;
		background: transparent;
		color: #dbe1e8;
		cursor: pointer;
		font-size: 12px;
		font-weight: 700;
		text-align: left;
		padding: 0 10px;
	}

	.export-menu button:last-child {
		border-bottom: 0;
	}

	.export-menu button:hover {
		background-color: #424750;
	}

	.segmented {
		overflow: hidden;
		border: 1px solid #50535b;
		border-radius: 5px;
		background-color: #303238;
		gap: 0;
	}

	.segmented button {
		height: 30px;
		border: 0;
		border-right: 1px solid #50535b;
		border-radius: 0;
		background-color: transparent;
		padding: 0 10px;
		font-size: 13px;
		font-weight: 700;
	}

	.segmented button:last-child {
		border-right: 0;
	}

	.segmented button.selected {
		background-color: #59616d;
		color: #fff;
	}

	.icon-button.selected {
		border-color: #6f7784;
		background-color: #59616d;
		color: #fff;
	}

	.material-toggles .icon-button {
		padding: 0;
	}

	.projection-toggle button {
		display: grid;
		width: 30px;
		padding: 0;
		place-items: center;
	}

	.projection-toggle svg {
		width: 18px;
		height: 18px;
	}

	.backface-toggle svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.vertex-color-toggle svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.vertex-color-edge {
		opacity: 0.82;
	}

	.vertex-color-red,
	.vertex-color-green,
	.vertex-color-blue {
		stroke: #dbe1e8;
		stroke-width: 1;
	}

	.vertex-color-red {
		fill: #e85d5d;
	}

	.vertex-color-green {
		fill: #54c878;
	}

	.vertex-color-blue {
		fill: #4f8ee8;
	}

	.vertex-color-slash {
		stroke: currentColor;
		stroke-width: 2.4;
	}

	.tool-separator {
		width: 1px;
		height: 24px;
		background-color: #50535b;
	}

	.tool-spacer {
		flex: 1 1 24px;
		min-width: 12px;
	}

	.workspace {
		display: grid;
		height: 100%;
		max-height: 100%;
		min-height: 0;
		grid-template-columns: 340px minmax(280px, 1fr) 286px;
		grid-template-rows: minmax(0, 1fr);
		overflow: hidden;
	}

	.left-panel,
	.right-panel {
		display: flex;
		height: 100%;
		max-height: 100%;
		min-width: 0;
		min-height: 0;
		border-color: #3b3d43;
		background-color: #282a2f;
		overflow: hidden;
	}

	.left-panel {
		border-right: 1px solid #3b3d43;
	}

	.right-panel {
		border-left: 1px solid #3b3d43;
	}

	.panel-content,
	.details-content {
		min-width: 0;
		flex: 1;
		overflow: auto;
	}

	.navigator-section,
	.details-section {
		border-bottom: 1px solid #3b3d43;
		padding: 14px 12px;
	}

	.mesh-section {
		border-bottom: 0;
	}

	.panel-title {
		margin-bottom: 12px;
		color: #eef2f6;
		font-size: 17px;
		font-weight: 700;
	}

	.row-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mesh-header {
		margin-bottom: 12px;
	}

	.mesh-header .panel-title {
		margin-bottom: 0;
	}

	.mesh-title-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mesh-tree-toggle {
		display: grid;
		box-sizing: border-box;
		width: 24px;
		height: 24px;
		place-items: center;
		border: 1px solid #50535b;
		border-radius: 5px;
		background-color: #3e4148;
		color: #dbe1e8;
		cursor: pointer;
		padding: 0;
	}

	.mesh-tree-toggle:hover {
		border-color: #6f7784;
		background-color: #4a4e57;
	}

	.mesh-tree-toggle:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.mesh-tree-toggle svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.9;
	}

	.file-list,
	.mesh-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow: auto;
	}

	.mesh-list:focus {
		outline: none;
	}

	.tree-row,
	.empty-file-button,
	.muted-row {
		display: flex;
		min-height: 34px;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 4px;
		background-color: transparent;
		color: #d7dce3;
		text-align: left;
	}

	.tree-row {
		width: 100%;
		cursor: pointer;
		padding: 0 8px;
	}

	.file-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 22px;
	}

	.tree-row:hover,
	.tree-row.active {
		background-color: #363941;
	}

	.row-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-close-button {
		display: grid;
		box-sizing: border-box;
		width: 18px;
		height: 18px;
		justify-self: center;
		place-items: center;
		border: 1px solid #505761;
		border-radius: 50%;
		background: transparent;
		color: #9aa4b2;
		cursor: pointer;
		padding: 0;
	}

	.file-close-button:hover {
		border-color: #7d8794;
		color: #eef2f6;
	}

	.file-close-button svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-width: 2;
	}

	.empty-file-button {
		justify-content: center;
		border-radius: 5px;
		padding: 0 10px;
		font-weight: 700;
	}

	.muted-row {
		color: #87919e;
		padding: 0 8px;
	}

	.viewer-stage {
		height: 100%;
		max-height: 100%;
		min-width: 0;
		min-height: 0;
		background-color: #4e5058;
		overflow: hidden;
	}

	.viewfield {
		position: relative;
		display: flex;
		width: 100%;
		height: 100%;
		min-height: 0;
		align-content: center;
		justify-content: center;
		background: radial-gradient(circle at 50% 42%, #cfd3d7 0%, #9ea5ac 48%, #4e5058 100%), #4e5058;
		overflow: hidden;
	}

	.intro {
		position: absolute;
		inset: 10px;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border: 1px dashed rgba(255, 255, 255, 0.24);
		color: #f1f4f8;
		pointer-events: none;
		text-align: center;
	}

	.intro-mark {
		width: 74px;
		height: 74px;
		margin-bottom: 18px;
		color: #69b7e8;
	}

	.intro-title {
		font-size: 30px;
		font-weight: 700;
	}

	.intro-subtitle {
		margin-top: 10px;
		color: #282a2f;
		font-size: 15px;
	}

	.intro button {
		height: 36px;
		border-radius: 5px;
		margin-top: 22px;
		padding: 0 14px;
		font-weight: 700;
		pointer-events: auto;
	}

	.load-error {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 2;
		width: min(460px, calc(100% - 48px));
		transform: translate(-50%, -50%);
		border: 1px solid rgba(101, 110, 123, 0.75);
		border-radius: 6px;
		background-color: rgba(38, 41, 47, 0.92);
		box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
		color: #eef2f6;
		padding: 18px 20px;
		text-align: center;
	}

	.load-error-title {
		font-size: 18px;
		font-weight: 700;
	}

	.load-error-text {
		margin-top: 8px;
		color: #c8d0da;
		font-size: 14px;
		line-height: 1.35;
	}

	.property-table {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.property-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		color: #c0c7d0;
		font-size: 15px;
	}

	.property-row strong {
		color: #f0f4f8;
		font-weight: 700;
		text-align: right;
	}

	.unit-select {
		max-width: 132px;
		border: 1px solid #48515c;
		border-radius: 4px;
		background: #2d3138;
		color: #f0f4f8;
		padding: 3px 6px;
		font-weight: 700;
	}

	.overlay,
	.dropwrapper {
		position: absolute;
		inset: 0;
	}

	.overlay {
		z-index: 5;
		background-color: rgba(20, 22, 26, 0.45);
	}

	.dropwrapper {
		z-index: 6;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}

	.droparea {
		display: grid;
		width: calc(100% - 44px);
		height: calc(100% - 44px);
		place-items: center;
		border: 6px dashed #b5bac1;
		border-radius: 12px;
		color: #e8edf4;
		font-size: 52px;
		font-weight: 700;
	}

	::-webkit-scrollbar {
		width: 10px;
		height: 10px;
		background: #24262b;
	}

	::-webkit-scrollbar-thumb {
		border-radius: 5px;
		background: #17191d;
	}

	::-webkit-scrollbar-track {
		background: #2d3036;
	}

	@media (max-width: 1300px) {
		.workspace {
			grid-template-columns: 340px minmax(280px, 1fr);
		}

		.right-panel {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.app-header {
			grid-template-columns: minmax(0, 1fr) auto;
			height: auto;
			padding: 8px 10px;
		}

		.workspace {
			grid-template-columns: 1fr;
		}

		.left-panel,
		.right-panel {
			display: none;
		}
	}
</style>
