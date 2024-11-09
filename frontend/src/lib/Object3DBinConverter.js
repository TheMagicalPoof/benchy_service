import * as THREE from 'three';



class BinaryConverterStrategy {
    static serialize() {
        throw new Error('Method "serialize" can be realized.')
    }

    static deserialize() {
        throw new Error('Method "deserialize" can be realized.')
    }

}

class Object3DConverter extends BinaryConverterStrategy {
    static serialize(object) {
        const transferableArray = [];

        const data = {


        };

    }

    static deserialize(data) {

    }

}


class GeometryConverter {
    static serialize(geometry, transferableArray) {

    }

    static deserialize(data)  {

    }
}

class MaterialConverterFactory {
    static create(type) {
        switch (type) {
            case "MeshPhongMaterial":
                return new MeshPhongMaterialConverter();


        }
    }
}

// Abstract class for serialize/deserialize material common fields.
class MaterialConverter extends BinaryConverterStrategy {
    static SIMPLE_FIELDS = [
        "alphaHash", "alphaTest", "alphaToCoverage", "blendAlpha", "blendDst",
        "blendDstAlpha", "blendEquation", "blendEquationAlpha", "blending", "blendSrc",
        "blendSrcAlpha", "clipIntersection", "clipShadows", "colorWrite",
        "depthFunc", "depthTest", "depthWrite", "forceSinglePass", "isMaterial",
        "stencilWrite", "stencilWriteMask", "stencilFunc", "stencilRef",
        "stencilFuncMask", "stencilFail", "stencilZFail", "stencilZPass",
        "id", "name", "needsUpdate", "opacity", "polygonOffset", "polygonOffsetFactor",
        "polygonOffsetUnits", "precision", "premultipliedAlpha", "dithering",
        "shadowSide", "side", "toneMapped", "transparent", "type", "uuid",
        "version", "vertexColors", "visible", "userData"];

    static serialize(material, transferableArray) {
        const commonData = this._serializeCommon(material);
        const customData = this._serializeCustom(material, transferableArray);
        return { ...commonData, ...customData }
    }

    static deserialize(data) {
        const converter = MaterialConverterFactory.create(data.type);

        const commonData = this._deserializeCommon(data);
        const customData = converter._deserializeCustom(data);

        converter.getMaterial()


        return { ...commonData, ...customData } //MATERIAL

    }

    static _serializeCommon(material) {
        const data = {};

        for (const field of this.SIMPLE_FIELDS) {
            if (material[field] !== undefined) {
                data[field] = material[field];
            }
        }

        if (material.clippingPlanes) {
            data.clippingPlanes = material.clippingPlanes.map(plane => plane.toArray());
        }


        // Placeholder, need to replace in future.  https://threejs.org/docs/index.html#api/en/materials/Material
        data.defines = undefined;

        return data;
    }

    static _deserializeCommon(data) {
        const dict = {};

        for (const field of this.SIMPLE_FIELDS) {
            if (data[field] !== undefined) {
                dict[field] = data[field];
            }
        }

        if  (data.clippingPlanes) {
            dict.clippingPlanes = data.clippingPlanes.map(
                planeArray => {
                    return new THREE.Plane().fromArray(planeArray);
                }
            );
        }

        // Placeholder, need to replace in future.  https://threejs.org/docs/index.html#api/en/materials/Material
        dict.defines = undefined;

        return dict;
    }


    static _serializeCustom() {
        throw new Error('Method "_serializeCustom" can be realized.')
    }

    static _deserializeCustom() {
        throw new Error('Method "_deserializeCustom" can be realized.')
    }

    static getMaterial() {
        throw new Error('Method "getMaterial" can be realized.')
    }


}




class MeshPhongMaterialConverter extends MaterialConverter {
    getMaterial() { return new THREE.MeshPhongMaterial(); }

    _serializeCustom() {
        return {
            alphaMap: material.alphaMap ? TextureConverter.serialize(material.alphaMap, transferableArray) : null,
            color: material.color ? material.color.getHex() : null,
            emissive: material.emissive ? material.emissive.getHex() : null,
        }

    }

    _deserializeCustom() {
        
    }

    
}

class TextureConverter {
    static serialize(texture, transferableArray) {

    }

    static deserialize(data) {

    }
}