

<script>
    import DropDownItem from "../lib/DropDownItem.svelte";
    import { createEventDispatcher, onMount } from 'svelte'
    const dispatch = createEventDispatcher()

    export let items = []

    export let placeholder = "Button";
    let childs = [];
    let isDropDownOpen = false;

    function click(e){
        e.preventDefault();
        isDropDownOpen = !isDropDownOpen;
        if (!isDropDownOpen) { hide() }
        dispatch("click", this)

    }


    export function hide() {
        isDropDownOpen = false;
        childs.forEach(i => i.hide());
    }

    function selected(event) {
        // console.log(event["detail"])
        hide()
        dispatch("select", event["detail"])
        // placeholder = event["detail"]
    }
     
</script>



<div class="dropdown">
    <button class="dropdownbutton" on:click={click}>{placeholder}
        <div class="dropdownarrow" style:rotate={isDropDownOpen ? '270deg' : '90deg'}/>
    </button>
    
    
    <ul class="dropdown-content" style:visibility={isDropDownOpen ? 'visible' : 'hidden'}>
        {#each items as item, index(item)}
            <li><DropDownItem bind:this={childs[index]} name={item["name"]} items={item["sub"]} on:select={selected}/></li>
        {/each}

    </ul>
</div>


<style>
    .dropdown {
        color: #b5bac1;
        font-family: "PT Sans", sans-serif;
        font-weight: 500;
        font-size: 18px;
        position: relative;
        margin: 10px;
        margin-right: 0px;
        width: auto;
        height: 36px;
    }

    .dropdownbutton {
        padding-left: 12px;
        padding-right: 8px;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: 0px 0px 17px 3px rgba(0,0,0,0.10);
        
        background-color: #4e5058;
        border-radius: 6px;
        z-index: 3;
        user-select: none;
    }

    .dropdownarrow {
        margin-left: 5px;
        width: 20px;
        height: 20px;
        background-image: url("right_arrow.svg");
        background-repeat: no-repeat;
        background-position: center;
        background-size: 90%;
    }

    .dropdown-content {
        top: 28px;
        width: 100%;
        position: absolute;
        z-index: 2;
        /* box-shadow: 0px 0px 17px 3px rgba(0,0,0,0.10); */
        
        
    }

    .dropdown-content > li {
        width: 100%;
        /* height: 28px; */
        text-align: center;
        vertical-align: top;
        align-items: start;
        position: relative;
        background-color: #27282c;
    }

    .dropdown-content > li:nth-child(1) {
        padding-top: 12px;
        
    }

    .dropdown-content > li:nth-last-child(-n + 1) {
        /* margin-bottom: 10px;
        background-color: #27282c; */
        border-radius: 0px 0px 10px 10px;
        padding-bottom: 5px;
    }

    .dropdown-content > li:hover {
        font-weight: 600;
    }

</style>