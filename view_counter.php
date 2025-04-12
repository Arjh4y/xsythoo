<?php
$counterFile = "views.txt";

if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "0");
}

$views = (int) file_get_contents($counterFile);
$views++;
file_put_contents($counterFile, $views);

header('Content-Type: application/json');
echo json_encode(["views" => $views]);
?>