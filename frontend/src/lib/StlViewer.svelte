<script>
	import * as THREE from "three"
    import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
    import { STLLoader } from 'three/addons/loaders/STLLoader'
	import { createEventDispatcher } from 'svelte'
	import { fade } from 'svelte/transition';

	import { onMount } from "svelte"

	// export let borderRadius = "none";
	const dispatch = createEventDispatcher()
	
	export let enDrop = true;

	let sm;
	let wrapper;

	let viewField;
	let viewer;


	let spinner = false;
	let droparea = false;

	let worker;

	const loader = new THREE.ObjectLoader();



	class SceneManager {
		constructor(viewer, resolutionWidth=1920, resolutionHeight=1080)
		{
			this.width = resolutionWidth;
			this.height = resolutionHeight;

			// DOM элемент
			this.viewer = viewer;

			// компоненты сцены
			this.renderer;
			this.camera;
			this.controls;
			this.directionalLight;
			this.ambiantLight;
			this.scene;

			this._initScene()

		}

		autoScale(object3D) {
			// Вычисляем описанную сферу объекта
			const boundingSphere = new THREE.Sphere();
			new THREE.Box3().setFromObject(object3D).getBoundingSphere(boundingSphere);

			// Получаем направление камеры
			const cameraDirection = new THREE.Vector3();
			this.camera.getWorldDirection(cameraDirection);

			// Вычисляем вектор от камеры до объекта
			const toObject = new THREE.Vector3().subVectors(boundingSphere.center, this.camera.position);

			// Проецируем вектор на направление камеры, чтобы получить расстояние вдоль линии взгляда
			const distance = cameraDirection.dot(toObject);

			if (distance <= 0) {
				console.warn("Объект находится позади камеры или слишком близко.");
				return object3D;
			}

			// Вычисляем размеры фрустума на расстоянии до объекта
			const fovInRadians = THREE.MathUtils.degToRad(this.camera.fov);
			const frustumHeight = 2 * distance * Math.tan(fovInRadians / 2);
			const frustumWidth = frustumHeight * this.camera.aspect;

			// Вычисляем необходимый масштаб для вписывания объекта
			const scale = Math.min(
				frustumWidth / (2 * boundingSphere.radius),
				frustumHeight / (2 * boundingSphere.radius)
			);

			// Создаем группу и добавляем в нее объект
			const group = new THREE.Group();
			this.scene.add(group);
			group.add(object3D);

			// Сбрасываем позицию объекта внутри группы
			object3D.position.sub(boundingSphere.center);

			// Применяем масштаб к группе
			group.scale.set(scale, scale, scale);

			// Устанавливаем позицию группы так, чтобы объект был на нужном расстоянии и в центре вида камеры
			const newPosition = cameraDirection.clone().multiplyScalar(distance).add(this.camera.position);
			group.position.copy(newPosition);

			// Опционально: поворачиваем камеру на объект
			this.camera.lookAt(newPosition);

			return group;
		}

		viewerResize(resolutionWidth=1920, resolutionHeight=1080) // Ресайз окна сцены
		{
			// height = viewField.clientHeight;
			// width = viewField.clientWidth;

			this.height = resolutionHeight;
			this.width = resolutionWidth;
			this.camera.aspect = this.width / this.height;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(this.width, this.height);
		}

		updateScene(odjectsToAdd = []) // Обновить сцену, с элементами в массиве
		{
			this.scene.clear()
			this.scene.add(this.ambiantLight);
			this.scene.add(this.directionalLight);

			odjectsToAdd.forEach(obj => this.scene.add(this.autoScale(obj)));
			

		}

		_initScene() // Инициализация сцены
		{	
			this.scene = new THREE.Scene();
			this._initRenderer();
			this._initCamera();
			this._initControls();
			this._initLight();
			this.updateScene();
			this._startLoop();
		}

		_initRenderer() //Инициализация рендерера
		{	
			this.renderer = new THREE.WebGLRenderer({ antialias: true });
			// this.renderer.setSize(this.width, this.height);
			this.renderer.setClearColor(0x000000, 0);

			//adding canvas to viewZone DOM element
			// rendererDomElement.style.borderRadius = borderRadius;
			this.viewer.appendChild(this.renderer.domElement);
		}

		_initCamera() // Инициализщация камеры
		{
			this.camera = new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
			this.camera.position.z = 5;
			this.camera.position.x = 5;
			this.camera.position.y = 5;
		}

		_initControls() // Инициализация контроллера управления
		{
			this.controls = new TrackballControls(this.camera, this.viewer);
			this.controls.enabled = true;
			this.controls.rotateSpeed = 5;
			this.controls.panSpeed = 0.6;
			this.controls.maxDistance = 800;
			this.controls.minDistance = 1;
			this.controls.target = new THREE.Vector3(0, 0, 0.00001);
		}

		_initLight() // Инициализация света
		{
			this.directionalLight = new THREE.DirectionalLight(0xffffff, 2);
			this.directionalLight.position.z = 3;
			this.ambiantLight = new THREE.AmbientLight( 0x404040, 5);
		}

		_startLoop = () => // Запуск цикла отрисовки в каждом кадре
		{
			requestAnimationFrame(this._startLoop);
			this.controls.update();
			this.renderer.render(this.scene, this.camera);
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


function createFrustumVisual(camera) {
    const geometry = new THREE.BufferGeometry();

    // Define the 8 corners of the frustum in NDC space
    const ndcCorners = [
        new THREE.Vector3(-1, -1, -1), // Near Bottom Left
        new THREE.Vector3(1, -1, -1),  // Near Bottom Right
        new THREE.Vector3(1, 1, -1),   // Near Top Right
        new THREE.Vector3(-1, 1, -1),  // Near Top Left
        new THREE.Vector3(-1, -1, 1),  // Far Bottom Left
        new THREE.Vector3(1, -1, 1),   // Far Bottom Right
        new THREE.Vector3(1, 1, 1),    // Far Top Right
        new THREE.Vector3(-1, 1, 1)    // Far Top Left
    ];

    // Unproject NDC corners to world space
    const worldCorners = ndcCorners.map(ndcPoint => ndcPoint.clone().unproject(camera));

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
        0, 1, 5, 5, 4, 0,
        1, 2, 6, 6, 5, 1,
        2, 3, 7, 7, 6, 2,
        3, 0, 4, 4, 7, 3
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

	const material = new THREE.LineDashedMaterial(
            { 
            color: 0xffff00,
            linewidth: 5,
            scale: 2,
            dashSize: 3,
            gapSize: 1,
            // visible: this.enabled
            }
        );

    const frustumMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material);

    return frustumMesh;
}

// Функция для десериализации Object3D
function deserializeObject3D(data, arrayBuffers) {
    let object;

    // Создаем объект нужного типа
    if (data.type === 'Mesh') {
        object = new THREE.Mesh();
    } else if (data.type === 'LineSegments') {
        object = new THREE.LineSegments();
    } else {
        throw new Error(`Unsupported object type: ${data.type}`);
    }

    // Десериализация геометрии
    const geometryData = data.geometry;
    const geometry = new THREE.BufferGeometry();
    const attributes = geometryData.attributes;

    for (const name in attributes) {
        const attrData = attributes[name];
        // const arrayType = attrData.arrayType;
        // const ArrayConstructor = globalThis[arrayType];

        const array = arrayBuffers[attrData.bufferIndex];

        const attribute = new THREE.BufferAttribute(array, attrData.itemSize, attrData.normalized);
        geometry.setAttribute(name, attribute);
    }

    // Десериализация индексов (если есть)
    if (geometryData.index) {
        const indexData = geometryData.index;
        // const arrayType = indexData.arrayType;
        // const ArrayConstructor = globalThis[arrayType];

        const array = arrayBuffers[indexData.bufferIndex];

        const indexAttribute = new THREE.BufferAttribute(array, indexData.itemSize, indexData.normalized);
        geometry.setIndex(indexAttribute);
    }

    object.geometry = geometry;

    // Десериализация материала (упрощенно)
    const materialData = data.material;

    let material;
    if (materialData.type === 'MeshBasicMaterial') {
        material = new THREE.MeshBasicMaterial({ color: materialData.color });
    } else if (materialData.type === 'LineBasicMaterial') {
        material = new THREE.LineBasicMaterial({ color: materialData.color, linewidth: materialData.linewidth });
	} else if (materialData.type === 'MeshMatcapMaterial') {
        material = new THREE.MeshMatcapMaterial({ color: materialData.color});
    } else {
        material = new THREE.MeshBasicMaterial();
    }

    object.material = material;

    // Устанавливаем матрицу трансформации
	console.log(data.matrix);
    object.matrix.fromArray(data.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);

    // Восстанавливаем пользовательские данные
    object.userData = data.userData;

    return object;
}

	async function initializeWorker() {
		worker = new Worker('/src/lib/loadWorker.js', { type: 'module' }); // Создаем новый веб-воркер

		// Устанавливаем обработчик для сообщений от воркера
		worker.onmessage = (event) => {
			// const geometry = deserializeGeometry(event.data);
			// const json_obj = event.data;
			// renderObject(json_obj)


			const { data, arrayBuffers } = event.data;

			const object3D = deserializeObject3D(data, arrayBuffers);



			// Добавляем объект в сцену
			sm.updateScene([object3D]);
			spinner = false;

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
			console.error("Ошибка в воркере:", error); // Выводим ошибку в консоль
		};
    };


	function handlerDrop(event) {
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
		// dispatch("drop", { files })

		// Передаем массив файлов в воркер для обработки

		droparea = false;
		spinner = true;
		worker.postMessage(files.at(-1));

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


	};

	onMount(() => {

		sm = new SceneManager(viewer, viewField.clientWidth, viewField.clientHeight);
		
		const resizeObserver = new ResizeObserver(() => {
			sm.viewerResize(viewField.clientWidth, viewField.clientHeight)
		});

		resizeObserver.observe(wrapper);

		initializeWorker(); // Создаем воркер


	});


	
    function handleDragEnter() {
        droparea = true;
    };

	

</script>

<svelte:body on:dragenter|self={handleDragEnter} on:dragleave={() => droparea = false}/>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="wrapper" bind:this={wrapper}>
	
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class=viewfield bind:this={viewField}
		on:drop={handlerDrop}
		on:dragover={(e) => e.preventDefault()}
		on:dragleave={() => droparea = true}>
		

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
		<div class="dropwrapper" transition:fade={{delay: 100, duration: 200}}>
			<div class="droparea"> ПЕРЕТАЩИТЕ ФАЙЛЫ СЮДА</div>
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
        font-family: "PT Sans", sans-serif;
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
			box-shadow: 0 -3em 0 0.2em, 
			2em -2em 0 0em, 3em 0 0 -1em, 
			2em 2em 0 -1em, 0 3em 0 -1em, 
			-2em 2em 0 -1em, -3em 0 0 -1em, 
			-2em -2em 0 0;
		}
		12.5% {
			box-shadow: 0 -3em 0 0, 2em -2em 0 0.2em, 
			3em 0 0 0, 2em 2em 0 -1em, 0 3em 0 -1em, 
			-2em 2em 0 -1em, -3em 0 0 -1em, 
			-2em -2em 0 -1em;
		}
		25% {
			box-shadow: 0 -3em 0 -0.5em, 
			2em -2em 0 0, 3em 0 0 0.2em, 
			2em 2em 0 0, 0 3em 0 -1em, 
			-2em 2em 0 -1em, -3em 0 0 -1em, 
			-2em -2em 0 -1em;
		}
		37.5% {
			box-shadow: 0 -3em 0 -1em, 2em -2em 0 -1em,
			3em 0em 0 0, 2em 2em 0 0.2em, 0 3em 0 0em, 
			-2em 2em 0 -1em, -3em 0em 0 -1em, -2em -2em 0 -1em;
		}
		50% {
			box-shadow: 0 -3em 0 -1em, 2em -2em 0 -1em,
			3em 0 0 -1em, 2em 2em 0 0em, 0 3em 0 0.2em, 
			-2em 2em 0 0, -3em 0em 0 -1em, -2em -2em 0 -1em;
		}
		62.5% {
			box-shadow: 0 -3em 0 -1em, 2em -2em 0 -1em,
			3em 0 0 -1em, 2em 2em 0 -1em, 0 3em 0 0, 
			-2em 2em 0 0.2em, -3em 0 0 0, -2em -2em 0 -1em;
		}
		75% {
			box-shadow: 0em -3em 0 -1em, 2em -2em 0 -1em, 
			3em 0em 0 -1em, 2em 2em 0 -1em, 0 3em 0 -1em, 
			-2em 2em 0 0, -3em 0em 0 0.2em, -2em -2em 0 0;
		}
		87.5% {
			box-shadow: 0em -3em 0 0, 2em -2em 0 -1em, 
			3em 0 0 -1em, 2em 2em 0 -1em, 0 3em 0 -1em, 
			-2em 2em 0 0, -3em 0em 0 0, -2em -2em 0 0.2em;
		}
	}

	.wrapper {
        display: flex;
		width: 100%;
        height: 100%;

	}
	.viewer {
		position: relative;
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