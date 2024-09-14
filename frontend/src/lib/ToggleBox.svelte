<script>
    import { createEventDispatcher} from 'svelte'
    const dispatch = createEventDispatcher()

    export let isEnabled = false;
    export let name = "";
    export let isRightDir = true;


    function toggle() {
        isEnabled = !isEnabled;
        dispatch("toggle", isEnabled)
    }

</script>

<div class="label" class:reverse={!isRightDir}>
    <title>"test title"</title>
    <div class="name">{name}</div>
    <button class="togglebutton" class:enabled={isEnabled} on:click={toggle}>
        
        <div class="indicator"></div>
    </button>
</div>

<style>
    .label {
        color: #b5bac1;
        font-family: "PT Sans", sans-serif;
        font-weight: 500;
        font-size: 18px;
        display: flex;
        flex-direction: row;
        align-content: space-between;
        justify-content: end;
        

    }
    
    .label.reverse {
        flex-direction: row-reverse;
    }

    .name {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
    }

    .togglebutton {
        margin: 10px;
        display: flex;
        flex-direction: row;
        position: relative;
        justify-content: flex-start;
        align-items: center;
        background-color: #4e5058;
        width: 40px;
        height: 24px;
        border-radius: 13px;
        padding-left: 3px;
        padding-right: 3px;
        box-shadow: 0px 0px 5px 3px rgba(0,0,0,0.05);

    }

    .indicator {
        position: relative;
        
        /* left: 3px; */
        width: 18px;
        height: 18px;
        border-radius: 10px;
        background-color: #b5bac1;
        box-shadow: 0px 0px 5px 3px rgba(0,0,0,0.10);

    }

    .togglebutton.enabled {
        background-color: #057a55;
        justify-content: flex-end;
        transition: 100ms;
        box-shadow: 0px 0px 4px 3px rgba(8, 224, 26, 0.1);


    }



    

</style>