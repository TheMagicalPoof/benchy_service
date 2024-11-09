// Импортируем необходимые модули из Three.js
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

// Устанавливаем обработчик сообщения от основного потока
self.onmessage = async (event) => {
    const file = event.data; // Получаем файлы из сообщения


    // const geometry = await loadGeometryFromFile(file); // Загружаем геометрию


    // const mg = new MeshGenerator(geometry);

    // mg.update();


    // // Предполагается, что у вас есть объект THREE.Mesh или THREE.LineSegments
    // const { data, arrayBuffers, transferableArrays } = serializeObject3D(mg.getMesh());

    // // Передача данных в основной поток
    // postMessage({ data, arrayBuffers }, transferableArrays);

    // // self.postMessage(serializeGeometry(geometry));

    try {
        const extension = file.name.split(".").pop().toLowerCase();
        const factory = new LoadStrategyFactory();
        const strategy = factory.create(extension);
        const object3D = await strategy.load(file);
        const { data, arrayBuffers, transferableArrays } = serializeObject3D(object3D);
        postMessage({ data, arrayBuffers }, transferableArrays);

    } catch (error) {
        console.log("Ошибка:", error);
    }

};

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
            default:
                throw new Error(`Неподдерживаемый формат файла: ${fileExtension}`);
        }
    }
}

class BaseLoadStrategy {
    async load(file) {
        throw new Error("Метод load должен быть реализован")
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
                    reject(error)
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
                    const material = new THREE.MeshStandardMaterial({ vertexColors: true});
                    const mesh = new THREE.Mesh(geometry, material);
                    resolve(mesh);
                },
                undefined,
                (error) => {
                    reject(error)
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

function serializeObject3D(object) {
    const data = {
        uuid: object.uuid,
        type: object.type,
        name: object.name,
        matrix: object.matrix.toArray(),
        userData: object.userData,
        children: [],
    };

    const transferableObjects = [];

    if (object.isMesh || object.isLine || object.isPoints) {
        // Сериализуем геометрию
        data.geometry = serializeGeometry(object.geometry, transferableObjects);
        // Сериализуем материал
        console.log("typeof", typeof(object.material))


        // data.material = serializeMaterial(object.material);

        if (Array.isArray(object.material)) {
            data.material = object.material.map(m => serializeMaterial(m, transferableObjects));
        } else {
            data.material = serializeMaterial(object.material);
        }

    }

    console.log("DATA loader", data);
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
        index: null,
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
            buffer: array.buffer,
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
            buffer: array.buffer,
        };
        transferableObjects.push(array.buffer);
    }

    return data;
}

function serializeMaterial(material, transferableObjects) {
    console.log("loader:", material)
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
        normalMap: material.normalMap ? serializeTexture(material.normalMap, transferableObjects) : null,
        roughnessMap: material.roughnessMap ? serializeTexture(material.roughnessMap, transferableObjects) : null,
        metalnessMap: material.metalnessMap ? serializeTexture(material.metalnessMap, transferableObjects) : null,
        emissiveMap: material.emissiveMap ? serializeTexture(material.emissiveMap, transferableObjects) : null,
        alphaMap: material.alphaMap ? serializeTexture(material.alphaMap, transferableObjects) : null,
        // Добавьте другие свойства материала при необходимости
    };
    return data;
}

function serializeTexture(texture, transferableObjects) {
    console.log("texture loader:", typeof(texture));
    const image = texture.image;
    let imageData = null;

    if (image && image.data) {
        // Если текстура создана из данных (например, процедурная текстура)
        imageData = {
            width: image.width,
            height: image.height,
            data: image.data.buffer,
            dataType: image.data.constructor.name,
        };
        transferableObjects.push(image.data.buffer);
    } else if (image && image.src) {
        // Если текстура загружена из изображения
        imageData = {
            src: image.src,
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
        rotation: texture.rotation !== undefined ? texture.rotation : 0,
        // Добавьте другие свойства текстуры при необходимости
    };

    return data;
}