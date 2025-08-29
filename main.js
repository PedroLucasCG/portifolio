
// Navbar item click configuration
const itemsNavBar = document.querySelectorAll("nav ul li");
const itemsNavBarMenuItemsMobile = document.querySelector("nav ul li:last-of-type");
const dropdown = document.querySelector(".dropdown");
const nav = document.querySelector("nav");

const clearClicked = () => {
    itemsNavBar.forEach((item) => item.classList.remove("clicked"));
};

const handleClicked = (e) => {
    const li = e.currentTarget;
    const wasActive = li.classList.contains("clicked");

    clearClicked();
    if (!wasActive) li.classList.add("clicked");
};

itemsNavBar.forEach((item) => {
    item.addEventListener("click", handleClicked);
});

document.addEventListener("click", (e) => {
    if (!nav.contains(e.target)) {
        clearClicked();
        dropdown?.classList.add("hide");
    }
});

itemsNavBarMenuItemsMobile?.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown?.classList.toggle("hide");
});
