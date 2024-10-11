// Импортируем необходимые модули из Three.js
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// Устанавливаем обработчик сообщения от основного потока
self.onmessage = async (event) => {
    const file = event.data; // Получаем файлы из сообщения


    const geometry = await loadGeometryFromFile(file); // Загружаем геометрию

    // Отправляем загруженные геометрии обратно в основной поток
    const mg = new MeshGenerator(geometry);
    // const lmg = new LinearMeshGenerator(geometry);

    //mg.setMatcap("matcap.jpg");
    mg.update();
    // lmg.update();

    // console.log("обычный", mg.getMesh());

    // console.log("линейный:", lmg.getMesh());
    
    // self.postMessage(mg.getMesh().toJSON());

    // Предполагается, что у вас есть объект THREE.Mesh или THREE.LineSegments
    const { data, arrayBuffers, transferableArrays } = serializeObject3D(mg.getMesh());

    // Передача данных в основной поток
    postMessage({ data, arrayBuffers }, transferableArrays);

    // self.postMessage(serializeGeometry(geometry));
};

function loadGeometryFromFile(file) {
    // console.log(file)
    return new Promise((resolve, reject) => {
        const loader = new STLLoader(); // Создаем экземпляр STLLoader

        // Загружаем файл по URL
        loader.load(
            URL.createObjectURL(file), // Создаем URL для объекта файла
            geometry => {
                resolve(geometry); // Разрешаем промис с загруженной геометрией
            },
            undefined, // Прогресс
            error => {
                reject(error); // Отклоняем промис с ошибкой
            }
        );
    });
}


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


    setColor(value)
    {
        this.color = value;
        this.update();
    }

    setMatcap(value)
    {
        this.matcap = MeshGenerator.loadTexture(value);
        this.update();
    }
    isEnabled(value) { this.enabled = value }
    getMesh() { return this.mesh }

    constructor(geometry)
    {
        // mesh settings
        this.color = "#aaffaa";
        this.enabled = true;

        // components
        this.matcap;
        this.material;
        this.geometry = geometry
        this.mesh;

        this.update();

    }

    // Загрузить текстуру
    static loadTexture(path) { return new THREE.TextureLoader().load(path) }

    static setCenter(mesh) // Установить центральную точку мэша
    {	
        const boundingBox = new THREE.Box3().setFromObject(mesh);
        const center = boundingBox.getCenter(new THREE.Vector3());
        mesh.position.sub(center);
        mesh.updateMatrix();
        return mesh
    }

    update()
    {
        this._calcMaterial()
        this._calcMesh()
    }

    _calcMaterial() // Обсчёт материала
    {
        this.material = new THREE.MeshMatcapMaterial(
            { 
            color: this.color,
            // visible: this.enabled,
            matcap: this.matcap || null
            }
        );
    }

    _calcMesh() // Расчёт мэша
    {
        this.mesh = this.enabled ? MeshGenerator.setCenter(new THREE.Mesh(this.geometry, this.material)) : null;
    }
};

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
function serializeObject3D(object) {
    // Сериализованные данные
    const data = {
        type: object.type, // 'Mesh', 'LineSegments' и т.д.
        geometry: {},
        material: {},
        matrix: object.matrix.toArray(),
        userData: object.userData
    };

    // Сериализация геометрии
    const geometry = object.geometry;
    const geometryData = data.geometry;

    // Сериализуем атрибуты геометрии
    geometryData.attributes = {};
    const attributes = geometry.attributes;

    const transferableArrays = [];
    const arrayBuffers = []; // Хранение массивов для передачи

    for (const name in attributes) {
        const attribute = attributes[name];
        const array = attribute.array;

        // Сохраняем информацию об атрибуте
        geometryData.attributes[name] = {
            itemSize: attribute.itemSize,
            count: attribute.count,
            normalized: attribute.normalized,
            arrayType: array.constructor.name,
            // Добавляем идентификатор для связи с массивом
            bufferIndex: arrayBuffers.length
        };

        // Сохраняем массив
        arrayBuffers.push(array);
        // Добавляем buffer в список для передачи
        transferableArrays.push(array.buffer);
    }

    // Сериализация индексов (если есть)
    if (geometry.index) {
        const index = geometry.index;
        const array = index.array;

        geometryData.index = {
            itemSize: index.itemSize,
            count: index.count,
            normalized: index.normalized,
            arrayType: array.constructor.name,
            bufferIndex: arrayBuffers.length
        };

        arrayBuffers.push(array);
        transferableArrays.push(array.buffer);
    }

    // Сериализация материала (упрощенно)
    const material = object.material;
    data.material = {
        type: material.type,
        color: material.color ? material.color.getHex() : null,
        linewidth: material.linewidth || null
    };

    return { data, arrayBuffers, transferableArrays };
}