<script>
	import * as THREE from "three"
    import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
    import { STLLoader } from 'three/addons/loaders/STLLoader'
	import { createEventDispatcher } from 'svelte'

	import { onMount } from "svelte"

	export let borderRadius = "none";
	const dispatch = createEventDispatcher()
	
	export let autoRender = true;
	export let enDrop = true;

	let matcapTexture;

    const loader = new STLLoader();
	const scene = new THREE.Scene();
	
	let isInitedScene = false;
	let wrapper;
	let controls;
	let camera; 
	let renderer;
	let directionalLight;
	let ambiantLight;

	let viewField;
	let viewer;

	let modelGeometry = null;

	//init Skeleton variables
	export let enSkeletonVisibleButton = false;
	export let enSkeletonColorPicker = false;

	export let enSkeletonVisible = false;
	export let skeletonColor = "#aaffaa";
	let skeletonMaterial;
	let skeletonMesh;


	//init Mesh variables
	export let enMeshVisibleButton = false;
	export let enMeshColorPicker = false;

	export let enMeshVisible = true;
	export let meshColor = "#ffaaff";
	let meshMaterial;
	let mesh;

	let width, height;
	
	function getResolution() {
		height = viewField.clientHeight;
		width = viewField.clientWidth;
	};

	function initScene() {

		getResolution();

		//init renderer
		renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 0);
		

		//adding canvas to viewZone DOM element
		const rendererDomElement = renderer.domElement
		rendererDomElement.style.borderRadius = borderRadius;
		viewer.appendChild(rendererDomElement);
		

		//init camera
		camera = new THREE.PerspectiveCamera(75, width/height, 0.1, 1000);

		//init controls
		controls = new TrackballControls(camera, viewer);
		controls.enabled = true;
		controls.rotateSpeed = 5;
		controls.panSpeed = 0.6;
        controls.maxDistance = 800;
        controls.minDistance = 1;
		controls.target = new THREE.Vector3(0, 0, 0.00001);

		//init light
		directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.z = 3;
		ambiantLight = new THREE.AmbientLight( 0x404040, 5);

		isInitedScene = true;

		//update scene elements
		sceneUpd();

		// start main loop
		mainLoop();
	};

	function sceneUpd() {
		if (modelGeometry == null) { return };
		scene.clear()

		if (enSkeletonVisible) { scene.add(skeletonMesh) };

		scene.add(mesh);
		scene.add(ambiantLight);
		scene.add(directionalLight);
	};

	function meshCalculate() {
		if (modelGeometry == null) { return };

		const skeletonGeometry = new THREE.EdgesGeometry( modelGeometry );
		skeletonMesh = new THREE.LineSegments( skeletonGeometry, skeletonMaterial );

		mesh = new THREE.Mesh( modelGeometry, meshMaterial );

		const boundingBox = new THREE.Box3().setFromObject(mesh);
		const center = boundingBox.getCenter(new THREE.Vector3());

		mesh.position.sub(center);
		skeletonMesh.position.sub(center);

	};
	
	
	export function loadStl(file) {
		console.log("tuta")
		loader.load (URL.createObjectURL(file), geometry => {
			modelGeometry = geometry
			meshCalculate();
		});

	};

	export function colorChange() {
		skeletonMaterial = new THREE.LineDashedMaterial( { 
			color: skeletonColor,
			linewidth: 5,
			scale: 2,
			dashSize: 3,
			gapSize: 1,
			visible: enSkeletonVisible
        });


		meshMaterial = new THREE.MeshMatcapMaterial({ 
			color: meshColor,
			visible: enMeshVisible,
			matcap: matcapTexture
		});

		meshCalculate();

	};
	
	function mainLoop() {
		requestAnimationFrame(mainLoop);
		controls.update();
		renderer.render(scene, camera);
	};

	


	async function handlerDrop(event) {
		if (!enDrop) return;
        event.preventDefault();

		let files = [];
        const items = event.dataTransfer.files;

        for (let i=0; i < items.length; i++) {
			const file = event.dataTransfer.files[i];

			if (!file["name"].toLowerCase().endsWith(".stl")) return;

            files.push(file);
        };
		
		if(files.length <= 0) return;
		dispatch("drop", { files })

        if (autoRender) { await renderStl(files.at(-1)) };

	};

	export async function renderStl(file) {
		modelGeometry = null;
		loadStl(file);

		await waitForGeometry();

		if (!isInitedScene) { initScene() };
		if (isInitedScene) { sceneUpd() };
	};

	function waitForGeometry() {
		return new Promise((resolve) => {
			function checkModelGeometry() {
				if (modelGeometry) {
					resolve();
				} else {
					setTimeout(checkModelGeometry, 100); // Check again after 100ms
				}
			};

			checkModelGeometry();
    	});
	};

	function viewerResize() {
		height = viewField.clientHeight;
		width = viewField.clientWidth;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height)

	}

	onMount(() => {
		matcapTexture = new THREE.TextureLoader().load("matcap.jpg");
		colorChange();
		const resizeObserver = new ResizeObserver(() => {
			if (isInitedScene) { viewerResize() }
		});

		resizeObserver.observe(wrapper);
	});


</script>


<div class="wrapper" bind:this={wrapper}>
	
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class=viewfield bind:this={viewField}
		on:drop={handlerDrop}
		on:dragover={(e) => e.preventDefault()}>

	<!-- {#if !modelGeometry}
		<div class="empty">
			<div class="filechoose">
				<label for="myfile" class="choose">Выберите файлы</label>
				<input type="file" multiple="multiple" accept=".stl" bind:this={uploadButton}/>
			</div>
		</div>
		
	{:else} -->
		<div class="viewer" bind:this={viewer}></div>
		<div class="checkfield">

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
		</div>
		
		
	
	<!-- {/if} -->
	</div>
</div>



<style>
	.wrapper {
        display: flex;
		width: 100%;
        height: 100%;

	}


	.viewfield {
		height: 100%;
		width: 100%;
		display: flex;
		justify-content: center;
		align-content: center;
		position: relative;
	
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

	input[type="checkbox"] {
    	display:none;
	}

	input[type="checkbox"] {
		color:#f2f2f2;
	}

	input[type="checkbox"] {
		display:block;
		height: 30px;
		width: 30px;
		right: 0px;
		margin: 0px;
		margin-bottom: 14px;
		border-radius: 5px;
		/* margin:-2px 10px 0 0; */
		/* vertical-align:middle; */
		background-image: url("skeleton.svg");
		cursor:pointer;
	}

	input[type="checkbox"]:checked {
		background-image: url("skeleton.svg");
	}



    input[type="color"]::-webkit-color-swatch {
        border-radius: 5px;
        border-color: black;
        border-width: 1.4px;

        background-image: url('color.svg');
        background-size: 20px;
        background-repeat: no-repeat;
        background-position: center;
		cursor:pointer;
        
        
    }

    input[type="color"]::-webkit-color-swatch:hover {
        box-shadow: 0px 0px 10px 0px rgba(0,0,0,0.5);
        
    }
    
    input[type="color"]::-webkit-color-swatch-wrapper {
        padding: 0;
        border-radius: 10px;
        
    }

</style>