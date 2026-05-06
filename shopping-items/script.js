let myItems = JSON.parse(localStorage.getItem("myItems")) || [];

// save items to local storage
function saveMyItems() {
    localStorage.setItem("myItems", JSON.stringify(myItems));
}

// show items on the page
function showItems() {
    let list = document.getElementById("shopping-list");
    let totalDisplay = document.getElementById("total");
    let total = 0;
    list.innerHTML = "";

    for (let i = 0; i < myItems.length; i++) {
        let item = myItems[i];

        // add price if item is bought
        if (item.purchased == true) {
            total = total + item.price * item.quantity;
        }

        let li = document.createElement("li");

        if (item.purchased == true) {
            li.className = "purchased";
        } else {
            li.className = "";
        }

        li.innerHTML = `
            <span>${item.name} (x${item.quantity}) - ksh${item.price}</span>
            <div>
                <button data-id="${i}" data-action="toggle">Done</button>
                <button data-id="${i}" data-action="edit">Edit</button>
                <button data-id="${i}" data-action="delete">Remove</button>
            </div>
        `;

        list.appendChild(li);
    }

    totalDisplay.textContent = total.toFixed(2);
}

// add new item when form is submitted
document.getElementById("form").addEventListener("submit", function(e) {
    e.preventDefault();

    let name = document.getElementById("item-input").value.trim();
    let quantity = parseInt(document.getElementById("quantity-input").value);
    let price = parseFloat(document.getElementById("category-input").value);

    // check if inputs are filled
    if (name == "" || isNaN(quantity) || isNaN(price)) {
        return;
    }

    let newItem = {
        name: name,
        quantity: quantity,
        price: price,
        purchased: false
    };

    myItems.push(newItem);
    saveMyItems();
    showItems();
    e.target.reset();
});

// handle button clicks on list
document.getElementById("shopping-list").addEventListener("click", function(e) {
    let id = e.target.dataset.id;
    let action = e.target.dataset.action;

    if (action == "toggle") {
        myItems[id].purchased = !myItems[id].purchased;
    }

    if (action == "delete") {
        myItems.splice(id, 1);
    }

    if (action == "edit") {
        let newName = prompt("Enter new name:", myItems[id].name);
        let newQty = prompt("Enter new quantity:", myItems[id].quantity);
        let newPrice = prompt("Enter new price:", myItems[id].price);

        if (newName != null && newQty != null && newPrice != null) {
            myItems[id].name = newName;
            myItems[id].quantity = parseInt(newQty);
            myItems[id].price = parseFloat(newPrice);
        }
    }

    saveMyItems();
    showItems();
});

// clear all items
document.getElementById("clear-button").addEventListener("click", function() {
    myItems = [];
    saveMyItems();
    showItems();
});

// load items when page opens
showItems();
