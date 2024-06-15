<script>
	import { onMount, onDestroy} from "svelte";
    import DropDownItem from "../lib/DropDownItem.svelte";
    import { createEventDispatcher } from 'svelte'

    export let name = "test"
    export let items = []
    export let description = "";
    export let link = "";
    let childs = [];
    let isHovered = false;
    let maxWidth = 0;

    let isItemOpen = false;

    const dispatch = createEventDispatcher()

    function click(e){
        e.preventDefault();
        isItemOpen = !isItemOpen;
        if (!isItemOpen) { hide() }
        if (items.length > 0) return;
        dispatch("select", name)
        
        
    }

    export function hide() {
        isItemOpen = false;
        childs.forEach(i => i.hide());

    }
    
    function hover() {
        isHovered = !isHovered;
    }

    function childSelected(event) {
        dispatch("select", name + " " + event["detail"])
    }

    onMount(() => {
        childs.forEach(child => {
            
            if (child.offsetWidth > maxWidth) {
                maxWidth = child.offsetWidth;
            }
        });

        maxWidth += 10;

    });

</script>


<button class="item-button"
    on:click={click}
    style:font-weight={isHovered ? 600 : 500}
    on:mouseenter={hover}
    on:mouseleave={hover}>{name}


    {#if items.length > 0}
    <div class="item-arrow" style:rotate={isItemOpen ? '180deg' : '0deg'}/>
    {/if}
</button>

{#if description}
    <div class="description"></div>
{/if}

{#if items.length > 0}
<ul class="dropdown-content" style:visibility={isItemOpen ? 'visible' : 'hidden'}>
    {#each items as item, i(item)}
        <li><DropDownItem bind:this={childs[i]} name={item["name"]} items={item["sub"]} on:select={childSelected}/></li>
    {/each}
    
</ul>
{/if}




<style>
    .item-button {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        width: 100%;
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        padding-left: 5px;
        padding-right: 5px;
    }

    .item-arrow {
        
        margin-left: 5px;
        width: 20px;
        height: 20px;
        background-image: url("right_arrow.svg");
        background-repeat: no-repeat;
        background-position: center;
        background-size: 90%;
    }

    .dropdown-content {
        padding-left: 3px;
        display: inline-block;
        left: 100%;
        top: -5px;
        position: absolute;
    }

    .dropdown-content > li {
        padding-right: 5px;
        padding-left: 5px;
        
        text-align: center;
        vertical-align: top;
        align-items: start;
        position: relative;
        background-color: #27282c;
    }

    .dropdown-content > li:nth-child(1) {
        padding-top: 5px;
        border-radius: 10px 10px 0px 0px;
    }

    .dropdown-content > li:nth-last-child(-n + 1) {
        border-radius: 0px 0px 10px 10px;
        padding-bottom: 5px;
    }

    .dropdown-content > li:only-child {
        border-radius: 10px 10px 10px 10px;
        padding-bottom: 5px;
        padding-top: 5px;
    }

</style>
