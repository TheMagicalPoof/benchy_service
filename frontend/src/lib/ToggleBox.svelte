<script>
    import { createEventDispatcher} from 'svelte'
    const dispatch = createEventDispatcher()

    export let isEnabled = false;

    function toggle() {
        isEnabled = !isEnabled;
        dispatch("toggle", isEnabled)
    }

</script>

<div class="label">
    <button class="togglebutton" class:enabled={isEnabled} on:click={toggle}>
        <div class="indicator"></div>
    </button>
</div>

<style>
    .togglebutton {
        margin: 10px;
        display: flex;
        flex-direction: row;
        position: relative;
        justify-content: flex-start;
        align-items: center;
        background-color: #4e5058;
        width: 42px;
        height: 26px;
        border-radius: 13px;
        padding-left: 3px;
        padding-right: 3px;
        box-shadow: 0px 0px 5px 3px rgba(0,0,0,0.05);


    }

    .indicator {
        position: relative;
        
        /* left: 3px; */
        width: 20px;
        height: 20px;
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