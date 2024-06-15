
<script>
    // import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/treejs/1.8.3/tree.js"
    import { onMount } from "svelte"
	import StlViewer from "../lib/StlViewer.svelte";
    import DropDown from "../lib/DropDown.svelte";
    import { fade } from 'svelte/transition';
	import ToggleBox from "../lib/ToggleBox.svelte";
    
    let dropdowns = [];
    const typedata = [
        {"name": "SLA"},
        {"name": "FDM"}
    ];

    const materialdata = [
        {"name": "PETG", "link": "https://nyan.cat/"},
        {"name": "PP", "link": "https://pp.cat/"},
        {"name": "ABS", "sub": [
            {"name": "Green", "description": "green.png"},
            {"name": "Dark Grey", "description": "darkgrey.png", "sub": [
                {"name": "Green", "description": "green.png"}
            ]}
        ]}
    ];

    let activeItem;
    let files;
    let itemsIsEmpty = "empty";
    let items = [];
    let viewer;
    let explorer;
    let isOverlayActive = false;
    
    $: if(items) {
        setTimeout(() => {if (explorer) explorer.scrollTo(0, explorer.scrollHeight) }, 2);
    }

    class PrintItemContainer {
        constructor() {
            this.items = []
        };

        push(files) {
            for(let i = 0; i < files.lenght; i++ ) {
                const file = files[i];
                if (file != typeof(File)) { continue };
                if (!file["name"].toLowerCase().endsWith(".stl")) { continue };
                if (this._isExist(file)) { continue };

            };
            

            this.items.push(new PrintItem(file));
        };

        _isExist(file) {
            this.items.forEach((item) => {
                if (item.getName == file["name"] && item.getSize == file["size"]) {return true;}
            });

            return false;
        };
    }

    class PrintModel {
        constructor(file) {
            this.file = file;
            this.quantity = 1;
            this.material = "PETG"
            this.color = "#238636"
            this.comment = ""
        } 
        
        getName() {
            return this.file["name"]
        };

        getSize() {
            return this.file["size"]
        };
    }

    // onMount( async() => {
        
    // });


    // $: if (files) {
    //     console.log(files)
    //     // for(const file of files) {
    //     //     console.log(file);
    //     //     // items.push()
    //     // }

    // }

    function uploadHandler(event) { 
        event.preventDefault();
        fileUploader(event.target.files)
    };

    function dropHandler(event) { 
        event.preventDefault();
        isOverlayActive = false;

        if(event.dataTransfer?.files) {
            fileUploader(event.dataTransfer.files);
            return;
        };

        if(event.detail?.files) {
            fileUploader(event.detail.files);
            return;
        };
    };

    function fileUploader(files) {

        for(let i = 0; i < files.length; i++) {
            
            if (!files[i]["name"].toLowerCase().endsWith(".stl")) return;
            items.push(files[i]);
        };
        if (files.lenght <= 0) return;

        itemsIsEmpty = "";
        items = [...items];
        
        itemSelect(items.length -1);
        // viewer.renderStl(items.at(-1));
        // activeItem = items.index(items.at(-1));
    };

    
    async function itemSelect(index) {
        console.log(index)
        activeItem = index;
        await viewer.renderStl(items[index])

    };

    function handleDragEnter() {
        isOverlayActive = true;
    };

    function handleDragLeave(e) {
        e.preventDefault();
        isOverlayActive = false


    };
    
    function selected(event) {
        console.log(event["detail"])
    }

    function hideExcept(index) {
        dropdowns.forEach( (dropdown, i) => {
            if (index !== i) {
                dropdown.hide()
            }
        })
         
    }

</script>

<svelte:body on:dragenter|self={handleDragEnter} on:dragover={(e) => {e.preventDefault()}}/>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="midbody" on:drop={dropHandler} on:dragover={(e) => e.preventDefault()}>
    <div class="explorer">
        <div class="wrapper">
            <div class="title">СПИСОК ФАЙЛОВ</div>
            <div class="filelist {itemsIsEmpty}" bind:this={explorer}>
                {#each items as item, index(item)}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class=file class:active={index == activeItem} on:click={() => itemSelect(index)}>{item["name"]}</div>
                {/each}
            
            </div>

            <label class="input-file">
                <input type="file" multiple="multiple" accept=".stl" bind:this={files} on:change={uploadHandler}/>		
                <span>Выберите файл</span>
            </label>

        </div>
    </div>
    
    <div class="itemfield">
        <div class="viewfield">
            <StlViewer bind:this={viewer} borderRadius="0px 10px 0px 0px" autoRender={false} enDrop={false}/>
        </div>
        <div class="itemdata">
            <div class="datarowtop">
                <DropDown placeholder="Тип печати" items={typedata}
                    on:select={selected}
                    on:click={() => hideExcept(0)}
                    bind:this={dropdowns[0]}/>

                <DropDown placeholder="Материал" items={materialdata}
                    on:select={selected}
                    on:click={() => hideExcept(1)}
                    bind:this={dropdowns[1]}/>

                 
                
                <!-- <button class="remove" title="Удалить модель"></button> -->
                <div class="quantity">
                    <input type="number" min=1 max=300 step=1 placeholder="Кол-во"/>
                </div>


                
            </div>
            <div class="datarowbot">
                <!-- <Textarea class="p-10" {...textareaprops} /> -->
                <ToggleBox on:toggle={(e) => {console.log(e.detail)}}/>
            </div>
        </div>
    </div>
    {#if isOverlayActive}
    <div class="dropwrapper" transition:fade={{delay: 100, duration: 200}}>
        <div class="droparea"> ПЕРЕТАЩИТЕ ФАЙЛЫ СЮДА</div>
    </div>
    {/if}

    
</div>

{#if isOverlayActive}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="overlay" transition:fade={{duration: 400}} on:dragleave={handleDragLeave} on:drop={handleDragLeave}/>
{/if}



<style>
    .overlay {
        position: absolute;
        left: 0px;
        top: 0px;
        width: 100%;
        height: 100%;
        background-color: #1a1b1e;
        overflow: hidden;
        z-index: 1;
        opacity: 0.5;
    }

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

    .input-file {
        position: relative;
        display: inline-block;
        margin-left: 10px;
    }

    .input-file span {
        user-select: none;
        font-family: "PT Sans", sans-serif;
        font-weight: 550;
        font-size: 19px;
        height: 55px;
        width: 100%;
        position: relative;
        display: inline-block;
        cursor: pointer;
        outline: none;
        text-decoration: none;
        vertical-align: middle;
        color: #b5bac1;
        text-align: center;
        border-radius: 4px;
        background-color: #4e5058;
        line-height: 22px;
        box-sizing: border-box;
        border: none;
        margin: 0;
        align-content: center;
        transition: background-color 0.2s;
    }

    .input-file input[type=file] {
        position: absolute;
        z-index: -1;
        opacity: 0;
        display: block;
        width: 0;
        height: 0;
    }
    
    .input-file:hover span {
        background-color: #5a5b63;
    }


    .explorer {
        position: relative;
        left:0px;
        width: 35%;
        display: flex;
        flex-direction: column;
        background-color: #2b2d31;
        border-radius: 10px 0px 0px 10px;
        padding-right: 10px;
        padding-bottom: 10px;
        
        
    }


    .itemfield {
        width: 65%;
        height: 100%;
        background-color: #313338;
        border-radius: 0px 10px 10px 0px;
        display: flex;
        flex-direction: column;
        /* justify-content: center;
        align-content: center; */
        position: relative;
    }

    .itemdata {
        display: flex;
        height: 30%;
        width: 100%;
        display: flex;
        flex-direction: column;
    }

    .datarowtop {
        height: 30%;
        width: 100%;
        display: flex;
        flex-direction: row;
        align-items: center;

    }

    .datarowbot {
        height: 60%;
        width: 100%;

    }

    .remove {
        margin-left: auto;
        position: relative;
        height: 50px;
        width: 50px;
        /* margin: 10px; */
        margin-bottom: 2px;
        /* align-self: flex-start; */
        background-image: url("delete.svg");
        background-repeat: no-repeat;
        background-position: center;
        background-size: 60%;
        

    }

    .quantity {
        color: #b5bac1;
        font-family: "PT Sans", sans-serif;
        font-weight: 500;
        font-size: 18px;
        display: flex;
        flex-direction: row;
        align-self: flex-end;
        margin: 10px;
        width: auto;
        height: 36px;
    }
    
    .quantity > input {
        margin-left: 10px;
        width: 100px;
        border-radius: 6px;
        border-width: 2px;
        background-color: #2b2d31;
    }


    .viewfield {
        width: 100%;
        height: 70%;
        background-color: #27282c;
        border-radius: 0px 10px 0px 0px;
        display: flex;
        justify-content: center;
        align-content: center;
        position: relative;
        

        
    }

    .wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
        

    .title {
        color: #b5bac1;
        font-family: "PT Sans", sans-serif;
        font-weight: 550;
        font-size: 25px;
        height: 8%;
        align-content: center;
        padding-left: 30px;
        padding-top: 20px;
        user-select: none;
    }

    .plugbar {
        width: 10px;
        background-color: #2b2d31;
    }
    
    :root {
        background-color: #1e1f22;
    }

    :global(body) {
        margin: 0;
        padding: 0;
        min-height: 100vh;
        overflow: hidden;
    }

    .midbody {
        position: relative;
        display: flex;

        width: 800px;
        height: 600px;
        /* border: 6px  dotted #fb874f; */
        border-radius: 10px;
        box-shadow: 0px 0px 17px 3px rgba(0,0,0,0.13);
    }
    


    .filelist {
        /* position: relative; */
        left:0px;
        /* width: 30px;*/
        height: 90%;
        /* width: 35%; */
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        /* justify-content: space-evenly; */
        align-items: center;
        /* align-content: space-evenly; */
        overflow: auto;

        /* border-radius: 10px 0px 0px 10px; */
        align-items: stretch;
        padding-left: 10px;
        margin-bottom: 10px;
        margin-top: 10px;
    }

    .filelist.empty {
        background-image: url("upload.svg");
        background-repeat: no-repeat;
        background-position: center;
        background-size: 40%;

    }

    .file {
        color: #b5bac1;
        font-family: "PT Sans", sans-serif;
        font-weight: 500;
        font-style: normal;
        font-size: larger;
        align-content: center;
        margin-left: 10px;
        padding-left: 20px;
        margin-right: 10px;
        min-height: 45px;
        width: auto;
        border-radius: 7px;
        user-select: none;
        cursor: pointer;
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        padding-right: 20px;
    }


    .file:hover {
        background-color: rgba(55, 57, 63, 0.438);
    }

    .file.active {
        background-color: #383a40;
        box-shadow: 0px 0px 17px 3px rgba(0,0,0,0.10);
        font-weight: 550;
        transition: background-color 0.2s;


    }
    

    ::-webkit-scrollbar {
        background: #2b2d31;
        width: 11px;
    }

    ::-webkit-scrollbar-thumb {
        background: #1a1b1e;
        border-radius: 5px;
        cursor: pointer;
        /* opacity: 0.3; */
        
    }

    ::-webkit-scrollbar-track {
        background: #323436;
        border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb:hover {
        background: #1f2024;
    }
    

    

</style>

<svelte:head>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/treejs/1.8.3/tree.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
</svelte:head>

