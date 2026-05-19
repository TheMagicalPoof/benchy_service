<script>
	import { createEventDispatcher } from 'svelte';

	export let node;
	export let depth = 0;
	export let expandedIds = new Set();
	export let selectedMeshId = '';
	export let selectedNodeId = '';
	export let hiddenMeshIds = new Set();

	const dispatch = createEventDispatcher();

	$: hasChildren = Boolean(node?.children?.length);
	$: isMesh = node?.kind === 'mesh';
	$: meshIds = getMeshIds(node);
	$: hasMeshContent = meshIds.length > 0;
	$: isExpanded = !hasChildren || expandedIds.has(node.id);
	$: paddingLeft = `${Math.min(depth, 8) * 14 + 8}px`;
	$: meshColors = getMeshColors(node);
	$: commonColor = getCommonColor(meshColors);
	$: canPickColor = hasMeshContent;
	$: isMixedColor = canPickColor && !commonColor;
	$: colorValue = commonColor || '#cccccc';
	$: isSelected = node?.id === selectedNodeId || (!selectedNodeId && isMesh && node?.meshId === selectedMeshId);
	$: visibleMeshCount = meshIds.filter((meshId) => !hiddenMeshIds.has(meshId)).length;
	$: isVisible = !hasMeshContent || visibleMeshCount > 0;
	$: isPartiallyHidden = hasMeshContent && visibleMeshCount > 0 && visibleMeshCount < meshIds.length;

	function toggle(event) {
		event.stopPropagation();
		if (!hasChildren) return;
		dispatch('toggle', { id: node.id });
	}

	function changeColor(event) {
		event.stopPropagation();
		if (!canPickColor) return;
		dispatch('color', {
			meshId: isMesh ? node.meshId : meshIds[0],
			meshIds,
			nodeId: node.id,
			color: event.currentTarget.value
		});
	}

	function selectNode(event) {
		event.stopPropagation();
		if (!hasMeshContent) return;
		dispatch('select', {
			meshId: meshIds[0],
			meshIds,
			nodeId: node.id,
			name: node.name
		});
	}

	function toggleVisibility(event) {
		event.stopPropagation();
		if (!hasMeshContent) return;
		dispatch('visible', {
			meshIds,
			visible: !isVisible
		});
	}

	function getMeshIds(treeNode) {
		if (!treeNode) return [];
		if (treeNode.kind === 'mesh' && treeNode.meshId) return [treeNode.meshId];
		return (treeNode.children || []).flatMap(getMeshIds);
	}

	function getMeshColors(treeNode) {
		if (!treeNode) return [];
		if (treeNode.kind === 'mesh') return [normalizeHexColor(treeNode.color || '#cccccc')];
		return (treeNode.children || []).flatMap(getMeshColors);
	}

	function getCommonColor(colors) {
		const uniqueColors = Array.from(new Set((colors || []).filter(Boolean)));
		return uniqueColors.length === 1 ? uniqueColors[0] : '';
	}

	function normalizeHexColor(color) {
		return /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : '#cccccc';
	}
</script>

{#if node}
	<div class="tree-node">
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="tree-row"
			class:mesh-row={isMesh}
			class:selected={isSelected}
			class:hidden={!isVisible}
			class:partial-hidden={isPartiallyHidden}
			class:selectable={hasMeshContent}
			data-node-id={node.id}
			data-mesh-id={isMesh ? node.meshId : undefined}
			role={hasMeshContent ? 'button' : undefined}
			style:padding-left={paddingLeft}
			title={node.name}
			on:click={selectNode}
		>
			<button
				class="twisty"
				class:open={isExpanded}
				type="button"
				aria-label={isExpanded ? 'Collapse' : 'Expand'}
				disabled={!hasChildren}
				on:click={toggle}
			>
				<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg>
			</button>

			<span class="row-name">{node.name}</span>

			{#if canPickColor}
				<input
					class="mesh-color"
					class:mixed={isMixedColor}
					type="color"
					value={colorValue}
					title={isMixedColor ? 'Mixed group colors' : isMesh ? 'Mesh color' : 'Group color'}
					aria-label={`Color ${node.name}`}
					on:input={changeColor}
					on:click|stopPropagation
				/>
			{:else}
				<span class="mesh-color-spacer" aria-hidden="true"></span>
			{/if}

			{#if hasMeshContent}
				<button
					class="visibility-button"
					class:muted={!isVisible}
					class:partial={isPartiallyHidden}
					type="button"
					title={isVisible ? 'Hide branch' : 'Show branch'}
					aria-label={isVisible ? `Hide ${node.name}` : `Show ${node.name}`}
					on:click={toggleVisibility}
				>
					<svg viewBox="0 0 24 24">
						<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
						<circle cx="12" cy="12" r="3" />
						{#if !isVisible}
							<path d="M4 20 20 4" />
						{/if}
					</svg>
				</button>
			{:else}
				<span class="visibility-spacer" aria-hidden="true"></span>
			{/if}
		</div>

		{#if hasChildren && isExpanded}
			<div class="tree-children">
				{#each node.children as child (child.id)}
					<svelte:self
						node={child}
						depth={depth + 1}
						{expandedIds}
						{selectedMeshId}
						{selectedNodeId}
						{hiddenMeshIds}
						on:toggle
						on:color
						on:select
						on:visible
					/>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.tree-node {
		min-width: 0;
	}

	.tree-row {
		display: grid;
		min-height: 32px;
		grid-template-columns: 18px minmax(0, 1fr) 22px 22px;
		align-items: center;
		gap: 6px;
		border-radius: 4px;
		color: #d7dce3;
	}

	.tree-row:hover {
		background-color: #363941;
	}

	.tree-row.selectable {
		color: #eef2f6;
		cursor: pointer;
	}

	.tree-row.selected {
		background-color: #3a4856;
		color: #ffffff;
	}

	.tree-row.hidden .row-name {
		color: #7f8895;
	}

	.tree-row.partial-hidden .row-name {
		color: #b6bec9;
	}

	.twisty {
		display: grid;
		width: 18px;
		height: 24px;
		place-items: center;
		border: 0;
		background: transparent;
		color: #88929f;
		cursor: pointer;
		padding: 0;
	}

	.twisty:disabled {
		cursor: default;
		opacity: 0;
	}

	.twisty svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
		transition: transform 0.12s ease;
	}

	.twisty.open svg {
		transform: rotate(90deg);
	}

	.row-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mesh-color {
		-webkit-appearance: none;
		appearance: none;
		box-sizing: border-box;
		width: 18px;
		height: 18px;
		justify-self: center;
		border: 1px solid #505761;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		overflow: hidden;
		padding: 1px;
	}

	.mesh-color.mixed {
		border-color: #5f6874;
		background: transparent;
		opacity: 0.72;
		padding: 2px;
	}

	.mesh-color::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.mesh-color::-webkit-color-swatch {
		border: 0;
		border-radius: 50%;
	}

	.mesh-color.mixed::-webkit-color-swatch {
		opacity: 0;
	}

	.mesh-color::-moz-color-swatch {
		border: 0;
		border-radius: 50%;
	}

	.mesh-color.mixed::-moz-color-swatch {
		opacity: 0;
	}

	.mesh-color-spacer,
	.visibility-spacer {
		display: block;
		width: 22px;
		height: 22px;
	}

	.visibility-button {
		display: grid;
		width: 22px;
		height: 22px;
		justify-self: center;
		place-items: center;
		border: 0;
		background: transparent;
		color: #b8c2cf;
		cursor: pointer;
		padding: 2px;
	}

	.visibility-button:hover {
		color: #ffffff;
	}

	.visibility-button.muted {
		color: #5e6773;
	}

	.visibility-button.partial {
		color: #8996a6;
	}

	.visibility-button svg {
		width: 17px;
		height: 17px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}
</style>
